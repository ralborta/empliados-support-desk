import OpenAI from "openai";
import type { PrismaClient } from "@prisma/client";
import {
  detectLoosePlate,
  detectPlate,
  extractLastPlateFromThread,
  extractPlateCorrectionHint,
  extractPlatePrefixFromMessage,
  formatPlateWithSpaces,
  isBarePlatePrefixHint,
  isPlausibleVehiclePlate,
  looksLikeOdometerIntentStart,
  looksLikeOdometerHelpRequest,
  normalizePlate,
  threadTextSinceCompanySelection,
} from "@/lib/wara";
import { withOpenAiTimeout } from "@/lib/openaiTimeout";
import {
  consultarEstadoUnidades,
  looksLikeFlowControlCommand,
  looksLikeLiveUnitConsultIntent,
  looksLikePlateCorrectionRequest,
  looksLikeVehicleBrandOrUnitSearch,
  resolveWaraSessionByPhone,
  type WaraUnidadEstado,
} from "@/lib/waraApi";

/** Mensaje claro cuando la patente o prefijo no existe en la flota del cliente. */
export function buildFleetUnitNotFoundMessage(opts: {
  companyName?: string | null;
  prefix?: string | null;
  plate?: string | null;
  rawText?: string;
}): string {
  const company = opts.companyName?.trim() || "tu empresa";
  const prefixFromText = opts.rawText ? extractPlatePrefixFromMessage(opts.rawText) : null;
  const barePrefix =
    opts.rawText && isBarePlatePrefixHint(opts.rawText)
      ? String(opts.rawText)
          .trim()
          .replace(/^(la|el|esa|ese)\s+/i, "")
          .replace(/[\s\-_.]+/g, "")
          .toUpperCase()
      : null;
  const prefix = (opts.prefix ?? prefixFromText ?? barePrefix)?.trim().toUpperCase() || null;

  if (prefix) {
    return (
      `No hay ninguna unidad en la flota de ${company} con patente que empiece con ${prefix}. ` +
      `Ese prefijo no está en tu flota. Pasame la matrícula completa (ej. NKL 952) o escribí «listado de mis unidades».`
    );
  }

  if (opts.plate) {
    const display = formatPlateWithSpaces(opts.plate) ?? opts.plate;
    return (
      `La patente ${display} no está en la flota de ${company}. ` +
      `Revisá que esté bien escrita. Si la unidad es de otra empresa, escribí «cambiar empresa».`
    );
  }

  return (
    `No encontré esa unidad en la flota de ${company}. ` +
    `Pasame la matrícula completa o el nombre exacto. Si querés ver opciones, escribí «listado de mis unidades».`
  );
}

/** Entrada que debe resolver contra la flota (patente, prefijo, marca, corrección). */
export function looksLikeFleetUnitSearchInput(rawText: string): boolean {
  return (
    !!detectLoosePlate(rawText) ||
    isBarePlatePrefixHint(rawText) ||
    !!extractPlatePrefixFromMessage(rawText) ||
    !!extractPlateCorrectionHint(rawText) ||
    looksLikeVehicleBrandOrUnitSearch(rawText) ||
    looksLikePlateCorrectionRequest(rawText)
  );
}

/** Respuesta de patente/prefijo tras pedido de mantenimiento (no un trámite nuevo). */
export function isMaintenancePlateSelectionMessage(rawText: string): boolean {
  const text = rawText.trim();
  if (!text) return false;
  if (looksLikeFlowControlCommand(text)) return false;
  if (looksLikeFleetUnitSearchInput(text)) return true;
  return (
    text.length <= 16 &&
    !/\b(mantenimiento|preventiv\w*|correctiv\w*|quiero|necesito|programar|registrar|reiniciar|inicio|menu|volver|cancelar)\b/i.test(
      text,
    )
  );
}

export type UnitQueryIntent = "list_fleet" | "consult_status" | "need_clarification";

export type UnitQueryResolution = {
  intent: UnitQueryIntent;
  plate?: string;
  searchTerms: string[];
  candidatePlates: string[];
  clarificationQuestion?: string;
  source: "ai" | "rules";
};

const STOPWORDS = new Set([
  "quiero",
  "saber",
  "consultar",
  "consulta",
  "reporte",
  "certificado",
  "cobertura",
  "constancia",
  "monitoreo",
  "mantenimiento",
  "preventivo",
  "correctivo",
  "odometro",
  "odómetro",
  "horometro",
  "horómetro",
  "registrar",
  "actualizar",
  "cambio",
  "estado",
  "unidad",
  "unidades",
  "vehiculo",
  "vehículo",
  "camion",
  "camión",
  "flota",
  "wara",
  "plataforma",
  "cuento",
  "tengo",
  "mis",
  "las",
  "los",
  "del",
  "de",
  "la",
  "el",
  "en",
  "por",
  "favor",
  "dame",
  "decime",
  "mostrame",
  "mostrá",
  "ver",
  "todas",
  "todo",
  "como",
  "cómo",
  "esta",
  "está",
  "que",
  "qué",
  "hola",
  "buenas",
  "porfa",
  "porfavor",
  "algunas",
  "nombre",
  "marca",
  "continuar",
  "servicio",
  "perfecto",
  "atilio",
  "mesa",
  "ayuda",
  "guara",
  "para",
  "necesito",
  "quiero",
  "generar",
  "solicitar",
  "pedir",
]);

function normalizeToken(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, "");
}

function normalizeLoosePlate(value: string): string {
  return normalizePlate(value)?.replace(/\s+/g, "") ?? "";
}

/** Búsqueda determinística por marca/nombre en patente + unidad (campo Wara). */
function resolveBrandOrNameInFleet(
  rawText: string,
  units: WaraUnidadEstado[],
): UnitQueryResolution | null {
  if (!looksLikeVehicleBrandOrUnitSearch(rawText) && !extractPlateCorrectionHint(rawText)) {
    return null;
  }
  const terms = tokenizeSearchTerms(rawText).filter((t) => t.length >= 3);
  if (!terms.length) return null;
  const matches = filterUnitsBySearchTerms(units, terms);
  const candidatePlates = matches
    .map((u) => normalizeLoosePlate(u.patente || u.unidad || ""))
    .filter(Boolean);
  if (matches.length === 1) {
    return {
      intent: "consult_status",
      plate: candidatePlates[0],
      searchTerms: terms,
      candidatePlates,
      source: "rules",
    };
  }
  if (matches.length > 1) {
    const labels = matches
      .slice(0, 8)
      .map((u) => (u.patente || u.unidad || "").trim())
      .join(", ");
    return {
      intent: "need_clarification",
      searchTerms: terms,
      candidatePlates,
      clarificationQuestion: `Encontré ${matches.length} unidades (${labels}). Decime la patente exacta.`,
      source: "rules",
    };
  }
  return null;
}

/**
 * Verifica los candidatos de la IA contra coincidencias reales de texto en la flota.
 * IMPORTANTE: si el término (marca/nombre) no aparece en NINGÚN patente/unidad real,
 * no hay que confiar en la lista de la IA — ese caso suele significar que la IA se
 * "ancló" repitiendo su propia respuesta anterior (la ve en el historial que le
 * pasamos como contexto) en vez de admitir que no encuentra la unidad. Devolver la
 * lista sin filtrar ahí generaba loops: el mismo mensaje de clarificación se repetía
 * turno tras turno aunque el cliente rechazara las opciones.
 */
function filterAiCandidatesByFleetTerms(
  rawText: string,
  units: WaraUnidadEstado[],
  candidatePlates: string[],
): string[] {
  const terms = tokenizeSearchTerms(rawText).filter((t) => t.length >= 3);
  if (!terms.length || candidatePlates.length === 0) return candidatePlates;
  const matches = filterUnitsBySearchTerms(units, terms);
  if (!matches.length) return [];
  const groundedPlates = matches
    .map((u) => normalizeLoosePlate(u.patente || u.unidad || ""))
    .filter(Boolean);
  const allowed = new Set(groundedPlates);
  const filtered = candidatePlates.filter((p) => allowed.has(p));
  // Si la IA propuso patentes que no coinciden con ninguna unidad real para ese
  // término, preferimos las coincidencias reales de texto en vez de su respuesta.
  return filtered.length > 0 ? filtered : groundedPlates;
}

function reconcileAiClarification(
  ai: UnitQueryResolution,
  rawText: string,
  units: WaraUnidadEstado[],
): UnitQueryResolution {
  const brandRules = resolveBrandOrNameInFleet(rawText, units);
  if (brandRules?.intent === "consult_status" && brandRules.plate) {
    return brandRules;
  }

  const filtered = filterAiCandidatesByFleetTerms(rawText, units, ai.candidatePlates);
  const sameAsAi =
    filtered.length === ai.candidatePlates.length &&
    filtered.every((p) => ai.candidatePlates.includes(p));

  if (filtered.length === 1) {
    return {
      intent: "consult_status",
      plate: filtered[0],
      searchTerms: ai.searchTerms,
      candidatePlates: filtered,
      source: "rules",
    };
  }
  if (filtered.length === 0 && looksLikeVehicleBrandOrUnitSearch(rawText)) {
    // Marca/nombre sin ninguna unidad real coincidente: cortar acá, no repetir
    // candidatos ajenos al pedido (evita el loop por anclaje en el historial).
    return {
      intent: "need_clarification",
      searchTerms: ai.searchTerms,
      candidatePlates: [],
      clarificationQuestion: buildFleetUnitNotFoundMessage({ rawText }),
      source: "rules",
    };
  }
  if (filtered.length > 1 && !sameAsAi) {
    const labels = filtered
      .slice(0, 8)
      .map((p) => formatPlateWithSpaces(p) ?? p)
      .join(", ");
    return {
      intent: "need_clarification",
      searchTerms: ai.searchTerms,
      candidatePlates: filtered,
      clarificationQuestion: `Encontré ${filtered.length} unidades (${labels}). Decime la patente exacta.`,
      source: "rules",
    };
  }
  if (brandRules?.intent === "need_clarification" && brandRules.candidatePlates.length > 0) {
    return brandRules;
  }
  return ai;
}

function compactUnitsForAi(
  units: WaraUnidadEstado[],
  opts?: { prefixHint?: string | null; limit?: number },
): Array<{ movil_id: number; patente: string; unidad: string }> {
  const limit = opts?.limit ?? 120;
  let pool = units;
  const prefix = opts?.prefixHint?.trim().toUpperCase();
  if (prefix) {
    const filtered = filterUnitsByPlatePrefix(units, prefix);
    if (filtered.length > 0) pool = filtered;
  }
  return pool.slice(0, limit).map((u) => ({
    movil_id: u.movil_id,
    patente: (u.patente ?? "").trim(),
    unidad: (u.unidad ?? "").trim(),
  }));
}

function prefixHintFromMessage(rawText: string): string | null {
  return (
    extractPlatePrefixFromMessage(rawText) ??
    (isBarePlatePrefixHint(rawText)
      ? rawText
          .trim()
          .replace(/^(la|el|esa|ese)\s+/i, "")
          .replace(/[\s\-_.]+/g, "")
          .toUpperCase()
      : null)
  );
}

function looksLikeUnitListRequest(rawText: string): boolean {
  const norm = rawText
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (detectPlate(rawText)) return false;
  return /\b(listado|lista de unidad|lista de unidades|lista\s+(?:mi|mis)\s+unidades|list[aá]\s+(?:mi|mis)\s+unidades|listame|list[aá]me|pasame la lista|p[aá]same la lista|me pasas la lista|dame la lista|ver lista|mis unidades|todas las unidades|todas mis unidades|reporte de mis unidades|reporte de las unidades|flota|cuantas unidades|cu[aá]ntas unidades|ver unidades|mis camiones|que unidades|qu[eé] unidades|unidades que cuento|cuantas tengo|cu[aá]ntas tengo|cuento en wara|cuento en la plataforma)\b/.test(
    norm
  );
}

function tokenizeSearchTerms(text: string): string[] {
  const tokens = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
  return Array.from(new Set(tokens));
}

/** Referencia vaga al hilo — ahí sí conviene mezclar historial. */
function looksLikeVagueUnitReference(rawText: string): boolean {
  const norm = rawText
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return /\b(esa|ese|esa unidad|ese vehiculo|ese veh[ií]culo|la misma|el mismo|la anterior|la del hilo|la que dije|la que mencione|la que mencion[eé])\b/.test(
    norm
  );
}

function shouldAvoidThreadSearchTerms(rawText: string): boolean {
  const norm = rawText
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (/\b(certificado|cobertura|monitoreo|constancia)\b/.test(norm) && !detectLoosePlate(rawText)) {
    return true;
  }
  return looksLikePlateCorrectionRequest(rawText) || !!extractPlateCorrectionHint(rawText);
}

/**
 * Términos de búsqueda: priorizar lo que escribió ahora.
 * Mezclar el hilo (p. ej. listado de flota) contamina marcas como "Nissan" con "alarma", "alex", etc.
 */
function extractSearchTerms(rawText: string, threadText: string): string[] {
  const fromMessage = tokenizeSearchTerms(rawText);
  if (fromMessage.length > 0 && !looksLikeVagueUnitReference(rawText)) {
    return fromMessage;
  }
  if (shouldAvoidThreadSearchTerms(rawText)) {
    return fromMessage;
  }
  return tokenizeSearchTerms(`${rawText} ${threadText}`.trim());
}

function filterUnitsBySearchTerms(units: WaraUnidadEstado[], terms: string[]): WaraUnidadEstado[] {
  if (!terms.length) return [];
  return units.filter((unit) => {
    const haystack = normalizeToken(`${unit.patente ?? ""} ${unit.unidad ?? ""}`);
    return terms.every((term) => {
      const norm = normalizeToken(term);
      if (!norm || norm.length < 3) return false;
      return haystack.includes(norm);
    });
  });
}

function filterUnitsByPlate(units: WaraUnidadEstado[], plate: string): WaraUnidadEstado[] {
  const wanted = normalizeLoosePlate(plate);
  if (!wanted) return [];
  return units.filter((u) => {
    const unitPlate = normalizeLoosePlate(u.patente || u.unidad || "");
    if (!unitPlate) return false;
    return unitPlate === wanted || unitPlate.includes(wanted) || wanted.includes(unitPlate);
  });
}

/** Prefijo de patente en frases como "la que empieza con AG". */
function extractPlatePrefixHint(rawText: string): string | null {
  return extractPlatePrefixFromMessage(rawText);
}

function shouldReuseThreadPlateForResolution(rawText: string): boolean {
  if (looksLikePlateCorrectionRequest(rawText)) return false;
  if (detectLoosePlate(rawText)) return false;
  if (extractPlateCorrectionHint(rawText)) return false;
  if (looksLikeOdometerIntentStart(rawText) || looksLikeOdometerHelpRequest(rawText)) return false;
  if (looksLikeVagueUnitReference(rawText)) return true;
  const norm = rawText
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (/\b(certificado|cobertura|monitoreo|constancia)\b/.test(norm) && !detectPlate(rawText)) return false;
  return looksLikeOdometerContinuation(rawText);
}

function hasCertificateFlowAwaitingUnit(threadText: string): boolean {
  const tail = threadText.slice(-3000).toLowerCase();
  return /para el certificado de cobertura necesito la unidad/.test(tail);
}

function shouldSkipAiForUnitResolution(rawText: string, _threadText: string): boolean {
  // Solo pedidos genéricos de certificado sin unidad concreta; NO bloquear selección (Nissan, NKL, etc.).
  return shouldSkipAiPlateInference(rawText);
}

function shouldSkipAiPlateInference(rawText: string): boolean {
  if (looksLikePlateCorrectionRequest(rawText)) return true;
  const norm = rawText
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return (
    /\b(certificado|cobertura|monitoreo|constancia)\b/.test(norm) &&
    !detectLoosePlate(rawText) &&
    !extractPlateCorrectionHint(rawText)
  );
}

function looksLikeOdometerContinuation(rawText: string): boolean {
  const norm = rawText
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return (
    /\b(od[oó]metro|hor[oó]metro|kilometraje|fecha|ayer|hoy)\b/.test(norm) ||
    /^\d{4,7}$/.test(rawText.replace(/\s+/g, ""))
  );
}

function resolvePlateCorrection(
  rawText: string,
  units: WaraUnidadEstado[],
): UnitQueryResolution | null {
  if (!looksLikePlateCorrectionRequest(rawText)) return null;
  const hint = extractPlateCorrectionHint(rawText);
  if (!hint) return null;

  const compactHint = hint.replace(/\s+/g, "").toUpperCase();
  const isPlateHint = isPlausibleVehiclePlate(compactHint);
  const isBrandHint = looksLikeVehicleBrandOrUnitSearch(hint) || looksLikeVehicleBrandOrUnitSearch(compactHint);

  let matches: WaraUnidadEstado[] = [];
  if (isPlateHint) {
    matches = filterUnitsByPlate(units, compactHint);
    if (matches.length === 0) {
      const fuzzy = fuzzyMatchUnitByPlate(units, compactHint);
      if (fuzzy) matches = [fuzzy];
    }
    if (matches.length === 0 && compactHint.length >= 2) {
      matches = filterUnitsByPlatePrefix(units, compactHint);
    }
  }

  if (matches.length === 0 && (isBrandHint || !isPlateHint)) {
    matches = filterUnitsBySearchTerms(units, [hint.toLowerCase()]);
  }

  if (matches.length === 0 && !isPlateHint && hint.length >= 3) {
    matches = filterUnitsBySearchTerms(units, tokenizeSearchTerms(hint));
  }

  if (matches.length === 1) {
    const plate = normalizeLoosePlate(matches[0].patente || matches[0].unidad || "") || hint;
    return {
      intent: "consult_status",
      plate,
      searchTerms: [hint.toLowerCase()],
      candidatePlates: [plate],
      source: "rules",
    };
  }
  if (matches.length > 1) {
    const labels = matches
      .slice(0, 5)
      .map((u) => (u.patente || u.unidad || "").trim())
      .join(", ");
    return {
      intent: "need_clarification",
      searchTerms: [hint.toLowerCase()],
      candidatePlates: matches
        .map((u) => normalizeLoosePlate(u.patente || u.unidad || ""))
        .filter(Boolean),
      clarificationQuestion: `Encontré varias unidades para "${hint}" (${labels}). Decime la patente exacta.`,
      source: "rules",
    };
  }
  return null;
}

function filterUnitsByPlatePrefix(units: WaraUnidadEstado[], prefix: string): WaraUnidadEstado[] {
  const p = prefix.replace(/\s+/g, "").toUpperCase();
  if (p.length < 2) return [];
  return units.filter((u) => {
    const unitPlate = normalizeLoosePlate(u.patente || u.unidad || "");
    return unitPlate.startsWith(p);
  });
}

/** Typo de 1 carácter en patente (ej. AG562ST → AG562SP) cuando hay candidato único. */
function fuzzyMatchUnitByPlate(
  units: WaraUnidadEstado[],
  inputPlate: string,
): WaraUnidadEstado | null {
  const wanted = normalizeLoosePlate(inputPlate);
  if (!wanted || wanted.length < 5) return null;

  const candidates = units
    .map((unit) => ({
      unit,
      plate: normalizeLoosePlate(unit.patente || unit.unidad || ""),
    }))
    .filter((c) => c.plate);

  const oneCharOff = candidates.filter((c) => {
    if (c.plate.length !== wanted.length) return false;
    let diffs = 0;
    for (let i = 0; i < wanted.length; i++) {
      if (c.plate[i] !== wanted[i]) diffs++;
    }
    return diffs === 1;
  });
  if (oneCharOff.length === 1) return oneCharOff[0].unit;

  if (wanted.length >= 4) {
    const prefix = wanted.slice(0, 4);
    const prefixMatches = candidates.filter((c) => c.plate.startsWith(prefix));
    if (prefixMatches.length === 1) return prefixMatches[0].unit;
  }

  return null;
}

function resolveUnitSelectionHint(
  rawText: string,
  units: WaraUnidadEstado[],
): UnitQueryResolution | null {
  const hint = extractPlateCorrectionHint(rawText);
  if (!hint || looksLikePlateCorrectionRequest(rawText)) return null;
  const norm = rawText
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (!/\b(de la|para la)\b/.test(norm)) return null;

  const compactHint = hint.replace(/\s+/g, "").toUpperCase();
  if (isPlausibleVehiclePlate(compactHint)) {
    const matches = filterUnitsByPlate(units, compactHint);
    if (matches.length === 1) {
      const plate = normalizeLoosePlate(matches[0].patente || matches[0].unidad || "") || compactHint;
      return {
        intent: "consult_status",
        plate,
        searchTerms: [],
        candidatePlates: [plate],
        source: "rules",
      };
    }
  }

  const prefixMatches = filterUnitsByPlatePrefix(units, compactHint);
  if (prefixMatches.length === 1) {
    const plate = normalizeLoosePlate(prefixMatches[0].patente || prefixMatches[0].unidad || "");
    if (!plate) return null;
    return {
      intent: "consult_status",
      plate,
      searchTerms: [],
      candidatePlates: [plate],
      source: "rules",
    };
  }
  if (prefixMatches.length > 1) {
    const labels = prefixMatches
      .slice(0, 5)
      .map((u) => (u.patente || u.unidad || "").trim())
      .join(", ");
    return {
      intent: "need_clarification",
      searchTerms: [],
      candidatePlates: prefixMatches
        .map((u) => normalizeLoosePlate(u.patente || u.unidad || ""))
        .filter(Boolean),
      clarificationQuestion: `Encontré ${prefixMatches.length} unidades que empiezan con ${compactHint} (${labels}). Decime la patente exacta.`,
      source: "rules",
    };
  }

  const brandFromHint = resolveBrandOrNameInFleet(hint || rawText, units);
  if (brandFromHint) return brandFromHint;

  return null;
}

function resolveWithRules(
  rawText: string,
  threadText: string,
  units: WaraUnidadEstado[]
): UnitQueryResolution {
  if (looksLikeUnitListRequest(rawText)) {
    return { intent: "list_fleet", searchTerms: [], candidatePlates: [], source: "rules" };
  }

  const correction = resolvePlateCorrection(rawText, units);
  if (correction) return correction;

  const unitSelection = resolveUnitSelectionHint(rawText, units);
  if (unitSelection) return unitSelection;

  if (looksLikeVehicleBrandOrUnitSearch(rawText)) {
    const brandResolution = resolveBrandOrNameInFleet(rawText, units);
    if (brandResolution) return brandResolution;
  }

  // Priorizar lo que escribió ahora; no arrastrar patente del odómetro u otro trámite previo.
  const threadPlate = extractLastPlateFromThread(threadText);
  const plateFromMessage =
    detectLoosePlate(rawText) ??
    (() => {
      const hint = extractPlateCorrectionHint(rawText);
      if (!hint) return "";
      if (isBarePlatePrefixHint(rawText) || extractPlatePrefixFromMessage(rawText)) return "";
      return hint;
    })() ??
    (shouldReuseThreadPlateForResolution(rawText) &&
    threadPlate &&
    isPlausibleVehiclePlate(threadPlate)
      ? threadPlate
      : "") ??
    "";
  if (plateFromMessage) {
    const plate = normalizeLoosePlate(plateFromMessage);
    let matches = filterUnitsByPlate(units, plate);
    if (matches.length === 0) {
      const fuzzy = fuzzyMatchUnitByPlate(units, plate);
      if (fuzzy) matches = [fuzzy];
    }
    if (matches.length === 0) {
      const prefixOnly =
        isBarePlatePrefixHint(rawText) ||
        !!extractPlatePrefixFromMessage(rawText) ||
        !isPlausibleVehiclePlate(plate);
      return {
        intent: "need_clarification",
        searchTerms: [],
        candidatePlates: [],
        clarificationQuestion: buildFleetUnitNotFoundMessage({
          rawText,
          prefix: prefixOnly ? plate : null,
          plate: prefixOnly ? null : plate,
        }),
        source: "rules",
      };
    }
    return {
      intent: matches.length === 1 ? "consult_status" : "need_clarification",
      plate:
        matches.length === 1
          ? normalizeLoosePlate(matches[0].patente || matches[0].unidad || "") || plate
          : plate,
      searchTerms: [],
      candidatePlates: matches.map((u) => normalizeLoosePlate(u.patente || u.unidad || "")).filter(Boolean),
      clarificationQuestion:
        matches.length > 1
          ? `Encontré varias unidades parecidas a ${plateFromMessage}. Decime la matrícula exacta.`
          : undefined,
      source: "rules",
    };
  }

  const prefixHint =
    extractPlatePrefixHint(rawText) ??
    (shouldReuseThreadPlateForResolution(rawText) ? extractPlatePrefixHint(threadText) : null);
  if (prefixHint) {
    const prefixMatches = filterUnitsByPlatePrefix(units, prefixHint);
    const candidatePlates = prefixMatches
      .map((u) => normalizeLoosePlate(u.patente || u.unidad || ""))
      .filter(Boolean);
    if (prefixMatches.length === 1) {
      return {
        intent: "consult_status",
        plate: candidatePlates[0],
        searchTerms: [],
        candidatePlates,
        source: "rules",
      };
    }
    if (prefixMatches.length > 1) {
      const labels = prefixMatches
        .slice(0, 8)
        .map((u) => (u.patente || u.unidad || "").trim())
        .join(", ");
      return {
        intent: "need_clarification",
        searchTerms: [],
        candidatePlates,
        clarificationQuestion: `Encontré ${prefixMatches.length} unidades que empiezan con ${prefixHint} (${labels}). Decime cuál querés consultar (patente exacta).`,
        source: "rules",
      };
    }
    return {
      intent: "need_clarification",
      searchTerms: [],
      candidatePlates: [],
      clarificationQuestion: buildFleetUnitNotFoundMessage({ rawText, prefix: prefixHint }),
      source: "rules",
    };
  }

  const terms = extractSearchTerms(rawText, threadText);
  const matches = filterUnitsBySearchTerms(units, terms);
  const candidatePlates = matches
    .map((u) => normalizeLoosePlate(u.patente || u.unidad || ""))
    .filter(Boolean);

  if (matches.length === 1) {
    return {
      intent: "consult_status",
      plate: candidatePlates[0],
      searchTerms: terms,
      candidatePlates,
      source: "rules",
    };
  }

  if (matches.length > 1) {
    const labels = matches
      .slice(0, 5)
      .map((u) => `${(u.patente || u.unidad || "").trim()}${u.unidad && u.patente ? ` (${u.unidad.trim()})` : ""}`)
      .join(", ");
    return {
      intent: "need_clarification",
      searchTerms: terms,
      candidatePlates,
      clarificationQuestion: `Encontré ${matches.length} unidades parecidas (${labels}). Decime la matrícula exacta para consultar una sola.`,
      source: "rules",
    };
  }

  return {
    intent: "need_clarification",
    searchTerms: terms,
    candidatePlates: [],
    clarificationQuestion: buildFleetUnitNotFoundMessage({ rawText }),
    source: "rules",
  };
}

async function resolveWithAi(
  rawText: string,
  threadText: string,
  units: WaraUnidadEstado[],
  opts?: { prefixHint?: string | null; maintenanceContext?: boolean; certificateContext?: boolean },
): Promise<UnitQueryResolution | null> {
  if (!process.env.OPENAI_API_KEY?.trim()) return null;

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const prefixHint = opts?.prefixHint ?? prefixHintFromMessage(rawText);
  const catalog = compactUnitsForAi(units, { prefixHint, limit: prefixHint ? 80 : 120 });

  const maintenanceCue = opts?.maintenanceContext
    ? `
- CONTEXTO: el bot pidió patente para registrar/programar mantenimiento. El mensaje es selección de unidad.
- Resolvé prefijos ("AD", "la que comienza con NKL") contra el catálogo.
- Una sola coincidencia clara → intent=consult_status con esa patente en candidatePlates.
- Varias coincidencias → intent=need_clarification listando patentes exactas del catálogo (hasta 8).`
    : opts?.certificateContext
      ? `
- CONTEXTO: el bot pidió la unidad para certificado de cobertura. El mensaje es selección de unidad (patente, prefijo, marca o nombre).
- Resolvé marcas/nombres (Nissan, Saveiro) y prefijos contra el catálogo.
- Una sola coincidencia clara → intent=consult_status con esa patente en candidatePlates.
- Varias coincidencias → intent=need_clarification listando patentes exactas del catálogo (hasta 8). PROHIBIDO preguntar genérico sin listar opciones.
- Usá el historial: si el cliente mencionó una marca y recién operó otra unidad (odómetro, GPS), priorizá esa patente si coincide en el catálogo.`
      : looksLikeLiveUnitConsultIntent(rawText)
        ? `
- CONTEXTO: consulta operativa de GPS, ignición o reporte en vivo (no mantenimiento ni certificado).
- Si el mensaje o el historial mencionan marca/nombre/patente, resolvé contra el catálogo.
- Si falta la unidad, intent=need_clarification pidiendo patente o marca con ejemplos.`
        : `
- Si el mensaje es prefijo o frase parcial de patente ("AD", "la q comienza con AD"), buscá en el catálogo.
- Si es marca o nombre (Nissan, Saveiro), buscá en el catálogo por nombre de unidad o coincidencias razonables.
- Una coincidencia → consult_status; varias → need_clarification con opciones reales del catálogo.`;

  const system = `Sos el resolvedor de consultas de unidades Wara para WhatsApp.
Devolvé SOLO JSON válido (sin markdown) con esta forma:
{"intent":"list_fleet"|"consult_status"|"need_clarification","candidatePlates":["AE483VE"],"clarificationQuestion":null}
Reglas:
- intent=list_fleet si piden listado/flota/cuántas unidades/cuento en wara.
- intent=consult_status si quieren estado/reporte/certificado/mantenimiento/odómetro/horómetro de una unidad concreta (marca, nombre o patente).
- candidatePlates: SOLO patentes que existan en el catálogo (sin espacios, mayúsculas).
- Si hay varias coincidencias razonables (marca, nombre parcial, prefijo), intent=need_clarification y pregunta breve en español rioplatense listando patentes.
- Nunca inventes patentes fuera del catálogo.
- Si no hay match claro y no es listado, intent=need_clarification pidiendo matrícula o nombre exacto.${maintenanceCue}`;

  const user = JSON.stringify({
    mensaje: rawText,
    historial: threadText.slice(-2000),
    catalogo: catalog,
  });

  try {
    const response = await withOpenAiTimeout((signal) =>
      openai.chat.completions.create(
        {
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          temperature: 0.1,
          max_tokens: 300,
          response_format: { type: "json_object" },
        },
        { signal },
      ),
    );
    if (!response) return null;

    const raw = response.choices[0]?.message?.content?.trim();
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      intent?: UnitQueryIntent;
      candidatePlates?: string[];
      clarificationQuestion?: string | null;
    };

    const intent = parsed.intent;
    if (intent !== "list_fleet" && intent !== "consult_status" && intent !== "need_clarification") {
      return null;
    }

    const candidatePlates = Array.isArray(parsed.candidatePlates)
      ? parsed.candidatePlates
          .map((p) => normalizeLoosePlate(String(p)))
          .filter((p) => p && units.some((u) => normalizeLoosePlate(u.patente || u.unidad || "") === p))
      : [];

    if (intent === "list_fleet") {
      return { intent, searchTerms: [], candidatePlates: [], source: "ai" };
    }

    if (intent === "need_clarification") {
      const labels =
        candidatePlates.length > 0
          ? candidatePlates
              .slice(0, 8)
              .map((p) => formatPlateWithSpaces(p) ?? p)
              .join(", ")
          : "";
      return {
        intent,
        searchTerms: [],
        candidatePlates,
        clarificationQuestion:
          parsed.clarificationQuestion?.trim() ||
          (labels
            ? `Encontré ${candidatePlates.length} unidades (${labels}). Decime la patente exacta.`
            : "¿Me pasás la matrícula exacta o el nombre de la unidad para consultarla en Wara?"),
        source: "ai",
      };
    }

    if (candidatePlates.length === 1) {
      return {
        intent: "consult_status",
        plate: candidatePlates[0],
        searchTerms: [],
        candidatePlates,
        source: "ai",
      };
    }

    if (candidatePlates.length > 1) {
      return {
        intent: "need_clarification",
        searchTerms: [],
        candidatePlates,
        clarificationQuestion:
          parsed.clarificationQuestion?.trim() ||
          "Encontré varias unidades posibles. Decime la matrícula exacta.",
        source: "ai",
      };
    }

    return null;
  } catch (error) {
    console.warn("[waraUnitIntent] IA falló, uso reglas:", error instanceof Error ? error.message : error);
    return null;
  }
}

function isDecisiveRulesResolution(
  resolution: UnitQueryResolution,
  rawText: string
): boolean {
  if (resolution.intent === "list_fleet") return true;
  if (resolution.intent === "consult_status" && resolution.plate) return true;
  if (resolution.intent === "need_clarification") {
    if (extractPlatePrefixFromMessage(rawText) || isBarePlatePrefixHint(rawText)) {
      return resolution.candidatePlates.length > 0;
    }
    if (resolution.clarificationQuestion && !resolution.candidatePlates.length) {
      if (
        looksLikeVehicleBrandOrUnitSearch(rawText) ||
        looksLikeLiveUnitConsultIntent(rawText)
      ) {
        return false;
      }
      return true;
    }
    if (resolution.candidatePlates.length > 1) {
      // Solo acortar con reglas si la ambigüedad viene del mensaje actual, no del hilo.
      const messageTerms = tokenizeSearchTerms(rawText);
      if (messageTerms.length > 0 && !looksLikeVagueUnitReference(rawText)) {
        return true;
      }
      return false;
    }
  }
  return false;
}

export async function resolveUnitQuery(params: {
  rawText: string;
  threadText: string;
  units: WaraUnidadEstado[];
  preferAi?: boolean;
  maintenanceContext?: boolean;
  certificateContext?: boolean;
}): Promise<UnitQueryResolution> {
  const prefixHint = prefixHintFromMessage(params.rawText);
  const brandOrLiveConsult =
    looksLikeVehicleBrandOrUnitSearch(params.rawText) ||
    looksLikeLiveUnitConsultIntent(params.rawText);
  const certificateCtx =
    params.certificateContext || hasCertificateFlowAwaitingUnit(params.threadText);
  const shouldPreferAi =
    params.preferAi ||
    params.maintenanceContext ||
    certificateCtx ||
    !!prefixHint ||
    isBarePlatePrefixHint(params.rawText) ||
    brandOrLiveConsult;

  // Mantenimiento / prefijo: reglas con catálogo completo primero (414 unidades); IA si no alcanza.
  if (shouldPreferAi && prefixHint) {
    const rulesPrefix = resolveWithRules(params.rawText, params.threadText, params.units);
    if (rulesPrefix.intent === "consult_status" && rulesPrefix.plate) return rulesPrefix;
    if (rulesPrefix.intent === "need_clarification" && rulesPrefix.candidatePlates.length > 0) {
      return rulesPrefix;
    }
    // Prefijo que no existe en TODA la flota: respuesta decisiva de reglas.
    // No tiene sentido preguntarle a la IA por un prefijo inexistente, va a improvisar.
    if (
      rulesPrefix.intent === "need_clarification" &&
      rulesPrefix.candidatePlates.length === 0 &&
      rulesPrefix.clarificationQuestion
    ) {
      return rulesPrefix;
    }
  }

  // Marca/nombre en trámite (certificado, etc.): reglas determinísticas antes que IA.
  if (certificateCtx && looksLikeVehicleBrandOrUnitSearch(params.rawText)) {
    const brandRules = resolveBrandOrNameInFleet(params.rawText, params.units);
    if (brandRules) return brandRules;
  }

  if (shouldPreferAi && process.env.OPENAI_API_KEY?.trim()) {
    const aiFirst = await resolveWithAi(params.rawText, params.threadText, params.units, {
      prefixHint,
      maintenanceContext: !!params.maintenanceContext,
      certificateContext: certificateCtx,
    });
    if (aiFirst?.intent === "consult_status" && aiFirst.plate) {
      const brandRules = resolveBrandOrNameInFleet(params.rawText, params.units);
      if (brandRules?.intent === "consult_status" && brandRules.plate) return brandRules;
      return aiFirst;
    }
    if (aiFirst?.intent === "need_clarification" && aiFirst.candidatePlates.length > 0) {
      return reconcileAiClarification(aiFirst, params.rawText, params.units);
    }
    // IA vaga (sin patentes del catálogo) → reglas con prefijo/filtro determinístico.
  }

  const rules = resolveWithRules(params.rawText, params.threadText, params.units);
  if (isDecisiveRulesResolution(rules, params.rawText)) return rules;

  const skipAi = shouldSkipAiForUnitResolution(params.rawText, params.threadText);
  const unitSearch = looksLikeFleetUnitSearchInput(params.rawText);
  if (skipAi && !unitSearch) return rules;

  const ai = await resolveWithAi(params.rawText, params.threadText, params.units, {
    prefixHint,
    maintenanceContext: !!params.maintenanceContext,
    certificateContext: certificateCtx,
  });
  if (ai) {
    if (rules.intent === "consult_status" && rules.plate && rules.candidatePlates.length === 1) {
      return rules;
    }
    if (
      ai.intent === "need_clarification" &&
      ai.candidatePlates.length === 0 &&
      rules.candidatePlates.length > 0 &&
      rules.clarificationQuestion
    ) {
      return rules;
    }
    if (
      ai.intent === "need_clarification" &&
      rules.plate &&
      rules.candidatePlates.length === 1
    ) {
      return rules;
    }
    return ai;
  }
  return rules;
}

export function filterUnitsByResolvedPlate(units: WaraUnidadEstado[], plate: string): WaraUnidadEstado[] {
  const exact = filterUnitsByPlate(units, plate);
  if (exact.length > 0) return exact;
  const fuzzy = fuzzyMatchUnitByPlate(units, plate);
  return fuzzy ? [fuzzy] : [];
}

export type PlateFromFleetResult =
  | { ok: true; plate: string; source: "direct" | "ai" | "rules" }
  | { ok: false; reason: "clarification"; message: string }
  | { ok: false; reason: "not_found" };

export type ResolvePlateWithWaraFleetOptions = {
  preferAi?: boolean;
  maintenanceContext?: boolean;
  certificateContext?: boolean;
};

/** Resuelve patente desde texto + flota Wara (IA/reglas). Uso compartido en todos los trámites. */
export async function resolvePlateWithWaraFleet(
  prisma: PrismaClient,
  rawPhone: string,
  rawText: string,
  threadText: string,
  directPlate?: string | null,
  opts?: ResolvePlateWithWaraFleetOptions,
): Promise<PlateFromFleetResult> {
  const normalizedDirect = directPlate ? normalizePlate(directPlate) : null;
  if (normalizedDirect) {
    return { ok: true, plate: normalizedDirect, source: "direct" };
  }

  if ((looksLikeOdometerIntentStart(rawText) || looksLikeOdometerHelpRequest(rawText)) && !detectLoosePlate(rawText)) {
    return { ok: false, reason: "not_found" };
  }

  if (shouldSkipAiForUnitResolution(rawText, threadText) && !looksLikeFleetUnitSearchInput(rawText)) {
    return { ok: false, reason: "not_found" };
  }

  const session = await resolveWaraSessionByPhone(prisma, rawPhone);
  if (!session.ok || !session.sessionToken) {
    return { ok: false, reason: "not_found" };
  }

  const fleet = await consultarEstadoUnidades(session.sessionToken, []);
  if (!fleet.ok || fleet.unidades.length === 0) {
    return { ok: false, reason: "not_found" };
  }

  const scopedThread = threadTextSinceCompanySelection(threadText);
  const resolved = await resolveUnitQuery({
    rawText,
    threadText: scopedThread,
    units: fleet.unidades,
    preferAi: opts?.preferAi || opts?.maintenanceContext || opts?.certificateContext,
    maintenanceContext: opts?.maintenanceContext,
    certificateContext: opts?.certificateContext,
  });

  if (resolved.intent === "need_clarification") {
    return {
      ok: false,
      reason: "clarification",
      message:
        resolved.clarificationQuestion ??
        buildFleetUnitNotFoundMessage({
          rawText,
          companyName: session.ok ? session.companyName : undefined,
        }),
    };
  }

  if (resolved.plate) {
    const plate = normalizePlate(resolved.plate);
    if (plate) return { ok: true, plate, source: resolved.source };
  }

  return { ok: false, reason: "not_found" };
}

export {
  looksLikeUnitListRequest,
  filterUnitsBySearchTerms,
  fuzzyMatchUnitByPlate,
  reconcileAiClarification,
  filterAiCandidatesByFleetTerms,
};
