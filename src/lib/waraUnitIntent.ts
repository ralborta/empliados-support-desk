import OpenAI from "openai";
import type { PrismaClient } from "@prisma/client";
import {
  detectAllPlates,
  detectLoosePlate,
  detectPlate,
  extractLastPlateFromThread,
  extractPlateCorrectionHint,
  extractPlatePrefixFromMessage,
  extractPlateSuffixFromMessage,
  formatPlateWithSpaces,
  isBarePlatePrefixHint,
  isPlausibleVehiclePlate,
  isOdometerFlowSuperseded,
  looksLikeOdometerIntentStart,
  looksLikeOdometerHelpRequest,
  looksLikeOdometerFlowReminder,
  normalizePlate,
  threadAwaitingHorometerKmValue,
  threadAwaitingHorometerPlate,
  threadAwaitingOdometerKmValue,
  threadAwaitingOdometerPlate,
  threadHasActiveOdometerFlow,
  threadHasFailedUnitSearch,
  threadHasOdometerUnitClarificationPending,
  threadOdometerRegistrationCompleted,
  threadTextSinceCompanySelection,
  hasPendingOdometerConfirmation,
  hasPendingUnitConsultPlateRequest,
  looksLikeBriefConfirmation,
  looksLikeExplicitOdometerUpdateRequest,
  looksLikeHorometerOnlyIntent,
  looksLikePendingTramiteAffirmation,
} from "@/lib/wara";
import { withOpenAiTimeout } from "@/lib/openaiTimeout";
import { findCustomerByWhatsAppNumber } from "@/lib/whatsappPhone";
import { looksLikeCustomerConversationCloseRequest } from "@/lib/customerConversationClose";
import {
  consultarEstadoUnidades,
  looksLikeFlowControlCommand,
  looksLikeGpsOrUnitStatusQuestion,
  looksLikeLiveUnitConsultIntent,
  looksLikeConversationalUnitConcern,
  looksLikeOdometerConfirmationRejection,
  looksLikePatenteUnknownReply,
  looksLikePlateCorrectionRequest,
  looksLikeSubstantiveCustomerMessage,
  looksLikeUnitReportingStatusCue,
  looksLikeVehicleBrandOrUnitSearch,
  threadHasRecentLiveUnitConsultIntent,
  threadHasRecentUnitProblemListenPrompt,
  resolveWaraSessionByPhone,
  type WaraUnidadEstado,
} from "@/lib/waraApi";

/** Mensaje claro cuando la patente o prefijo no existe en la flota del cliente. */
export function buildFleetUnitNotFoundMessage(opts: {
  companyName?: string | null;
  prefix?: string | null;
  plate?: string | null;
  rawText?: string;
  /**
   * El cliente SÍ escribió algo identificable (ej. "300-092", "M300-093") que se usó
   * como término de búsqueda, pero no matcheó ninguna unidad de su flota — a
   * diferencia del caso "sin dato" (ver más abajo). Bug real, producción 2026-07-23:
   * ambos casos devolvían el mismo "¿Cuál unidad?" genérico, como si el cliente nunca
   * hubiese escrito nada, cuando en realidad sí dio un dato concreto que simplemente no
   * está en la flota (o lo escribió distinto a como figura ahí) — confuso, porque
   * parece que el bot ignoró por completo lo que le pasaron.
   */
  searchedText?: string | null;
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
      `No encontré ninguna unidad en ${company} con patente que empiece con ${prefix}. ` +
      `¿Podés pasarme la matrícula completa (ej. OST 223)? También podés escribir «listado de mis unidades».`
    );
  }

  if (opts.plate) {
    const display = formatPlateWithSpaces(opts.plate) ?? opts.plate;
    return (
      `La patente ${display} no está en la flota de ${company}. ` +
      `Revisá que esté bien escrita. Si la unidad es de otra empresa, escribí «cambiar empresa».`
    );
  }

  const searched = opts.searchedText?.trim();
  if (searched) {
    return (
      `No encontré ninguna unidad que coincida con «${searched}» en la flota de ${company}. ` +
      `Revisá que esté bien escrito o pasame la matrícula completa (ej. NKL 952). ` +
      `Si querés ver opciones de tu flota, escribí «listado de mis unidades».`
    );
  }

  // Caso sin prefijo/patente detectados: puede ser que el cliente no haya dado
  // ningún dato concreto todavía (p. ej. "tengo problemas con una unidad") — no
  // hay que decir "no encontré ESA unidad" como si se hubiese rechazado una
  // patente puntual, porque puede que nunca se haya mencionado ninguna. Se pide
  // el dato con una frase neutra que sirve para ambos casos.
  return (
    `¿Cuál unidad? Pasame la matrícula completa o el nombre/marca exacto para buscarla en la flota de ${company}. ` +
    `Si querés ver todas, escribí «listado de mis unidades».`
  );
}

/**
 * Deja solo lo que escribió el cliente, descartando los mensajes del propio bot.
 * Se usa exclusivamente para el "historial" que se le manda a la IA al buscar una
 * unidad por marca/nombre: si le mostramos su propia respuesta anterior (p.ej. una
 * clarificación con patentes que no eran correctas), la IA tiende a "anclarse" y
 * repetirla en vez de volver a resolver contra el catálogo real de la flota. El
 * catálogo (API real) sigue siendo la única fuente de verdad para las patentes.
 */
function buildCustomerOnlyText(
  messages: Array<{ direction: string; text: string | null }>,
): string {
  return messages
    .filter((m) => m.direction !== "OUTBOUND")
    .map((m) => m.text)
    .filter((t): t is string => !!t)
    .join("\n");
}

/** Historial de solo-cliente para el prompt de la IA (ver `buildCustomerOnlyText`). */
async function customerOnlyThreadText(prisma: PrismaClient, rawPhone: string): Promise<string> {
  try {
    const customer = await findCustomerByWhatsAppNumber(prisma, rawPhone);
    if (!customer) return "";
    const ticket = await prisma.ticket.findFirst({
      where: { customerId: customer.id },
      orderBy: { lastMessageAt: "desc" },
    });
    if (!ticket) return "";
    const msgs = await prisma.ticketMessage.findMany({
      where: { ticketId: ticket.id },
      orderBy: { createdAt: "desc" },
      take: 24,
      select: { text: true, direction: true },
    });
    return buildCustomerOnlyText(msgs.reverse());
  } catch {
    return "";
  }
}

/** Nombre interno de unidad Wara (ej. M600-026, 300-092) — no es una patente. */
export function looksLikeUnitNameInMessage(rawText: string | undefined | null): boolean {
  const norm = String(rawText ?? "")
    .trim()
    .replace(/[\u2010-\u2015\u2212]/g, "-");
  if (!norm) return false;
  return /\b(?:M?\d{3}-\d{2,3})\b/i.test(norm);
}

/** Entrada que debe resolver contra la flota (patente, prefijo, marca, nombre/etiqueta). */
export function looksLikeFleetUnitSearchInput(rawText: string): boolean {
  const text = String(rawText ?? "").trim();
  if (!text) return false;
  // CONFIRMO / sí / dale nunca son búsqueda de unidad (bug 2026-08-07).
  if (looksLikeBriefConfirmation(text) || looksLikePendingTramiteAffirmation(text)) return false;
  if (looksLikeCustomerConversationCloseRequest(text)) return false;
  return (
    !!detectLoosePlate(text) ||
    isBarePlatePrefixHint(text) ||
    !!extractPlatePrefixFromMessage(text) ||
    !!extractPlateCorrectionHint(text) ||
    looksLikeVehicleBrandOrUnitSearch(text) ||
    looksLikePlateCorrectionRequest(text) ||
    looksLikeUnitNameInMessage(text) ||
    !!extractFreeTextUnitSearchCandidate(text)
  );
}

/** Respuesta de patente/prefijo/marca tras pedido de mantenimiento (no un trámite nuevo). */
export function isMaintenancePlateSelectionMessage(rawText: string): boolean {
  const text = rawText.trim();
  if (!text) return false;
  if (looksLikeBriefConfirmation(text) || looksLikePendingTramiteAffirmation(text)) return false;
  if (looksLikeOdometerConfirmationRejection(text)) return false;
  if (looksLikeFlowControlCommand(text)) return false;
  if (looksLikeFleetUnitSearchInput(text)) return true;
  if (extractPlatePrefixFromMessage(text) || isBarePlatePrefixHint(text)) return true;
  if (looksLikeVehicleBrandOrUnitSearch(text)) return true;
  // Bug real, producción 2026-07-28: tras "necesito la patente de la unidad" el
  // cliente respondió "para la misma unidad" (referencia vaga a la última unidad
  // resuelta en el hilo, ej. HEJ) — no es patente/prefijo/nombre explícito, y supera
  // los 16 caracteres del heurístico de abajo, así que la unidad nunca se resolvía y
  // el trámite de mantenimiento quedaba sin poder avanzar.
  if (looksLikeVagueUnitReference(text)) return true;
  return (
    text.length <= 16 &&
    !/\b(mantenimiento|preventiv\w*|correctiv\w*|quiero|necesito|programar|registrar|reiniciar|inicio|menu|volver|cancelar)\b/i.test(
      text,
    )
  );
}

/** Patente/prefijo/marca/referencia vaga mientras el hilo pide unidad para odómetro/horómetro. */
export function isOdometerPlateSelectionMessage(rawText: string): boolean {
  const text = rawText.trim();
  if (!text) return false;
  if (looksLikeBriefConfirmation(text) || looksLikePendingTramiteAffirmation(text)) return false;
  if (looksLikeOdometerConfirmationRejection(text)) return false;
  if (looksLikeFlowControlCommand(text)) return false;
  if (looksLikeFleetUnitSearchInput(text)) return true;
  if (looksLikeVagueUnitReference(text)) return true;
  if (looksLikePatenteUnknownReply(text)) return true;
  return (
    text.length <= 20 &&
    !/\b(certificado|cobertura|mantenimiento|preventiv\w*|gps|reporte|ignici[oó]n|consultar|reiniciar|inicio|menu|volver|cancelar)\b/i.test(
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
  "con",
  "una",
  "unos",
  "unas",
  "uno",
  "algo",
  "problema",
  "problemas",
  "anda",
  "andar",
  "andando",
  "funciona",
  "funcionando",
  "rota",
  "roto",
  "fallo",
  "falla",
  "fallando",
  "asi",
  "así",
  "tiene",
  "tienen",
  "hay",
  "estan",
  "están",
]);

function normalizeToken(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, "");
}

/** Palabras sueltas (sin acentos, sin unir) del patente+unidad, para matchear por PALABRA COMPLETA. */
function haystackWordsForUnit(unit: WaraUnidadEstado): string[] {
  const raw = `${unit.patente ?? ""} ${unit.unidad ?? ""}`;
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Bug real, producción 2026-07-28: normalizeToken pegaba TODAS las palabras del
 * patente+unidad en un solo string sin espacios (ej. "Mascotas GP30" → "mascotasgp30"),
 * y el match era "substring en cualquier lado". Un relleno conversacional corto como
 * "mas" (de "más", sin tilde) termina siendo substring literal de "Mascotas" — el
 * bot resolvía esa unidad al azar para mensajes como "mas lista"/"mas unidades" que
 * no tenían NADA que ver con ella. Ahora se exige coincidencia de PALABRA completa
 * (o, para términos de 4+ letras, que una de las dos sea prefijo de la otra — para
 * seguir tolerando variantes truncadas de marca real, ej. "camion" vs "camioneta").
 * Términos de 3 letras (el mínimo permitido) NUNCA matchean por prefijo — son
 * demasiado cortos y coinciden por pura casualidad con cualquier palabra larga.
 */
function termMatchesWord(term: string, word: string): boolean {
  if (!term || !word) return false;
  if (term === word) return true;
  if (term.length >= 4 && word.length >= 4 && (word.startsWith(term) || term.startsWith(word))) {
    return true;
  }
  // Nombres de flota con typo leve (Altamirano ↔ Altamiranda).
  if (term.length >= 6 && word.length >= 6) {
    const maxDist = Math.abs(term.length - word.length) <= 2 ? 2 : 1;
    if (levenshteinDistance(term, word) <= maxDist) return true;
  }
  return false;
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i++) {
    let prev = i;
    row[0] = i + 1;
    for (let j = 0; j < b.length; j++) {
      const cur = row[j + 1]!;
      const cost = a[i] === b[j] ? 0 : 1;
      row[j + 1] = Math.min(cur + 1, row[j]! + 1, prev + cost);
      prev = cur;
    }
  }
  return row[b.length]!;
}

function normalizeLoosePlate(value: string): string {
  return normalizePlate(value)?.replace(/\s+/g, "") ?? "";
}

/** Búsqueda determinística por marca/nombre/etiqueta en patente + unidad (campo Wara). */
function resolveBrandOrNameInFleet(
  rawText: string,
  units: WaraUnidadEstado[],
  nameHint?: string | null,
): UnitQueryResolution | null {
  // Código interno no se tokeniza ("300"+"097") — eso inventaba matches basura.
  if (looksLikeUnitNameInMessage(rawText) || (nameHint && looksLikeUnitNameInMessage(nameHint))) {
    return null;
  }
  const freeLabel = nameHint?.trim() || extractFreeTextUnitSearchCandidate(rawText);
  const canSearch =
    !!freeLabel ||
    looksLikeVehicleBrandOrUnitSearch(rawText) ||
    !!extractPlateCorrectionHint(rawText);
  if (!canSearch) return null;

  const sourceText = freeLabel || rawText;
  let terms = tokenizeSearchTerms(sourceText).filter((t) => t.length >= 3);
  if (!terms.length && freeLabel) {
    const one = normalizeToken(freeLabel);
    if (one.length >= 3) terms = [one];
  }
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
  const label = freeLabel || extractExplicitUnitSearchLabel(rawText) || terms.join(" ");
  if (label) {
    return {
      intent: "need_clarification",
      searchTerms: terms,
      candidatePlates: [],
      clarificationQuestion: buildFleetUnitNotFoundMessage({ rawText, searchedText: label }),
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
    const label = extractExplicitUnitSearchLabel(rawText);
    return {
      intent: "need_clarification",
      searchTerms: ai.searchTerms,
      candidatePlates: [],
      clarificationQuestion: buildFleetUnitNotFoundMessage({
        rawText,
        searchedText: label ?? undefined,
      }),
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
  // Nota: "norm" ya viene sin acentos (NFD + strip de diacríticos), así que alcanza con
  // matchear "mas" (sin tilde) para cubrir "más"/"mas" indistintamente.
  return /\b(listado|lista de flota|lista flota|lista de unidad|lista de unidades|lista de las unidades|necesito la lista|la lista de las unidades|lista\s+(?:mi|mis)\s+unidades|list[aá]\s+(?:mi|mis)\s+unidades|listame|list[aá]me|pasame la lista|p[aá]same la lista|p[aá]same la lista de flota|me pasas la lista|me pasas (?:la|mi|mis|el|tu) list\w*|p[aá]same (?:la|mi|mis|el|tu) list\w*|dame (?:la|mi|mis|el|tu) list\w*|me mostr[aá]s (?:la|mi|mis) list\w*|quiero ver (?:mi|mis|la|tu) (?:lista|listado|flota)|dame la lista|ver lista|mis unidades|todas las unidades|todas mis unidades|reporte de mis unidades|reporte de las unidades|flota|cuantas unidades|cu[aá]ntas unidades|ver unidades|mis camiones|que unidades|qu[eé] unidades|unidades que cuento|cuantas tengo|cu[aá]ntas tengo|cuento en wara|cuento en la plataforma|mas unidades|otras unidades|mas opciones|ver mas unidades|dame mas unidades|mostrame mas unidades|mas camiones|mas lista|resto de la lista|el resto de la lista|toda la lista)\b/.test(
    norm
  );
}

/** El cliente pidió listado/flota en el hilo reciente (incluye reintentos tras respuesta mala del bot). */
export function threadHasRecentFleetListIntent(threadText: string): boolean {
  const tail = threadText
    .slice(-3500)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return (
    /\b(listado|lista de flota|lista de unidades|pasame la lista|p[aá]same la lista|me pasas (?:la|mi|mis) list\w*|p[aá]same (?:la|mi|mis) list\w*|mis unidades|todas las unidades|ver toda la flota|necesito la lista)\b/.test(
      tail,
    ) || /\bten[eé]s \d+ unidades\b/.test(tail)
  );
}

/** El agente/bot pidió patente para "dar la lista" — lógica invertida, hay que corregir con listado real. */
function threadBotWronglyAskedPlateForList(threadText: string): boolean {
  if (!threadHasRecentFleetListIntent(threadText)) return false;
  const tail = threadText.slice(-2500).toLowerCase();
  return (
    /para poder pasarte la lista.*patente/.test(tail) ||
    /para poder pasarte la lista de tus unidades/.test(tail) ||
    /lista de unidades.*indiques la patente/.test(tail) ||
    /listado de unidades.*patente completa/.test(tail) ||
    /listado de mis unidades.*patente/.test(tail) ||
    (/pasame la matricula completa/.test(tail) && /lista de tus unidades/.test(tail))
  );
}

/** El bot ofreció enviar el listado de unidades (p. ej. agente: "¿Te gustaría que te pase el listado?"). */
export function threadBotOfferedUnitList(threadText: string): boolean {
  const tail = threadText
    .slice(-2800)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return (
    /gustar[ií]a que te pase el listado/.test(tail) ||
    /(te pase|pasarte|mostrarte).{0,48}(listado|lista de tus unidades|lista de unidades)/.test(tail) ||
    /(listado|lista).{0,48}(tus unidades|identificar la)/.test(tail)
  );
}

/** Confirmación o reintento mientras el cliente quiere ver la flota entera. */
export function looksLikeFleetListContinuation(rawText: string, threadText = ""): boolean {
  if (looksLikeUnitListRequest(rawText)) return true;
  // Bug real, producción 2026-07-30: "Ok" confirmando odómetro no es pedido de más flota.
  if (
    hasPendingOdometerConfirmation(threadText) &&
    (looksLikeBriefConfirmation(rawText) || looksLikePendingTramiteAffirmation(rawText))
  ) {
    return false;
  }
  const norm = rawText
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
  if (!norm) return false;
  if (detectLoosePlate(rawText) || extractPlatePrefixFromMessage(rawText)) return false;
  if (
    !threadHasRecentFleetListIntent(threadText) &&
    !threadBotWronglyAskedPlateForList(threadText) &&
    !threadBotOfferedUnitList(threadText)
  ) {
    return false;
  }
  if (
    /^(todo|todas|si|sí|dale|bueno|ok|listado|el listado|ninguna|no se|no s[eé]|no tengo idea|no la se|no las conozco|no recuerdo|mostrame todo|ver todas)([\s,.!]*(por favor|porfa|gracias|de una|genial|si|sí))*$/.test(
      norm,
    )
  ) {
    return true;
  }
  if (/\b(todas las unidades|listado de mis unidades|pasame el listado|ver toda la flota|la lista completa)\b/.test(norm)) {
    return true;
  }
  if (threadBotWronglyAskedPlateForList(threadText) && norm.length <= 24 && !looksLikeGpsOrUnitStatusQuestion(rawText)) {
    return true;
  }
  return false;
}

/**
 * Listado de flota → executor unidades directo (nunca pedir patente para "poder listar").
 */
export function shouldRouteTurnToFleetListExecutor(params: {
  selectionText: string;
  threadText: string;
}): boolean {
  if (looksLikeUnitListRequest(params.selectionText)) return true;
  if (looksLikeFleetListContinuation(params.selectionText, params.threadText)) return true;
  return false;
}

/** Cliente pidió ayuda para encontrar una unidad en el hilo reciente (respuesta de patente/nombre). */
export function threadHasRecentFleetUnitSearchRequest(threadText: string): boolean {
  const tail = threadText
    .slice(-2200)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return (
    /\bayudame a encontrar mi unidad\b/.test(tail) ||
    /\b(encontrar|buscar)\b.{0,80}\b(unidad|matricula|patente)\b/.test(tail) ||
    /\bno encuentro\b.{0,40}\b(unidad|patente|matricula)\b/.test(tail)
  );
}

/** Extrae la marca/nombre que el cliente intentó buscar ("es la NISSAN", "Altamiranda"). */
export function extractExplicitUnitSearchLabel(rawText: string): string | null {
  let t = String(rawText ?? "").trim();
  if (!t) return null;
  t = t
    .replace(/^(?:si|sí|ok|dale|bueno|perdon|perdón)[,.\s!]+/i, "")
    .replace(/^(?:es|son|sería|seria)\s+(?:la|el|una|un)\s+/i, "")
    .replace(/^(?:la|el)\s+/i, "")
    .trim();
  if (!t || t.length < 2) return null;
  if (detectLoosePlate(t) || looksLikeUnitNameInMessage(t) || looksLikeVehicleBrandOrUnitSearch(t)) {
    return t;
  }
  const free = extractFreeTextUnitSearchCandidate(rawText);
  if (free) return free;
  return null;
}

/**
 * Nombre/etiqueta de unidad en lenguaje natural (no solo marcas del catálogo cerrado).
 * Bug real 2026-08-06: "estado de Altamiranda" — el bot había listado ALTAMIRANDA JOSE
 * y pedía matrícula porque solo buscaba marcas tipo Nissan.
 */
export function extractFreeTextUnitSearchCandidate(rawText: string): string | null {
  const raw = String(rawText ?? "").trim();
  if (!raw || raw.length > 80) return null;
  // Bug real, producción 2026-08-07: "CONFIRMO" (pedido explícito del bot) matcheaba
  // como nombre propio de unidad → "No encontré ninguna unidad que coincida con «CONFIRMO»"
  // en vez de registrar el odómetro pendiente.
  if (looksLikeBriefConfirmation(raw) || looksLikePendingTramiteAffirmation(raw)) return null;
  // Bug 2026-08-07: "CERRAR TICKETS" se buscaba en flota en vez de cerrar el caso.
  if (looksLikeCustomerConversationCloseRequest(raw)) return null;
  if (detectLoosePlate(raw) || extractPlatePrefixFromMessage(raw)) return null;
  // Referencias vagas al hilo ("la unidad mencionada") NO son un nombre a buscar.
  if (looksLikeVagueUnitReference(raw)) return null;

  const cleaned = raw
    .replace(/^(?:perdon|perdón|disculpa|ok|dale|bueno)[,.\s!]+/i, "")
    .trim();

  // Solo "estado/reporte de <Nombre>" (o similar), no "estado de reporte de la unidad…".
  // El nombre no puede ser un sustantivo genérico del propio pedido (reporte/unidad/…).
  const statusOfName = cleaned.match(
    /\b(?:estado|reporte|gps|posicion|posici[oó]n)\s+(?:de\s+)?(?:la\s+)?(?:unidad\s+)?(?!reporte\b|estado\b|gps\b|unidad\b|patente\b|matricula\b|ubicaci[oó]n\b|coordenadas?\b)([A-Za-zÁÉÍÓÚáéíóúÑñ][A-Za-zÁÉÍÓÚáéíóúÑñ0-9.'-]{2,}(?:\s+[A-Za-zÁÉÍÓÚáéíóúÑñ][A-Za-zÁÉÍÓÚáéíóúÑñ0-9.'-]{1,}){0,2})\b/i,
  );
  if (statusOfName?.[1]) {
    const cand = statusOfName[1].trim();
    if (isPlausibleFreeTextUnitLabel(cand)) return cand;
  }

  const namedUnit = cleaned.match(
    /\b(?:unidad|chofer|conductor)\s+([A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚáéíóúÑñ0-9.'-]{2,}(?:\s+[A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚáéíóúÑñ0-9.'-]{1,}){0,2})\b/,
  );
  if (namedUnit?.[1]) {
    const cand = namedUnit[1].trim();
    if (isPlausibleFreeTextUnitLabel(cand)) return cand;
  }

  // Respuesta corta: solo el nombre propio ("Altamiranda", "Altamiranda Jose").
  if (/^[A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚáéíóúÑñ\s.'-]{2,40}$/.test(cleaned)) {
    const cand = cleaned.replace(/\s+/g, " ").trim();
    if (isPlausibleFreeTextUnitLabel(cand) && cand.split(/\s+/).length <= 3) return cand;
  }
  return null;
}

function isPlausibleFreeTextUnitLabel(cand: string): boolean {
  const norm = cand
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
  if (!norm || norm.length < 4) return false;
  if (STOPWORDS.has(norm)) return false;
  if (/^(confirmo|confirmado|confirma|confirmar|confirmacion)$/.test(norm)) return false;
  // Verbos / pedidos de gestión: no son etiquetas de flota.
  if (
    /\b(cerrar|resolver|finalizar|terminar|cancelar|reiniciar|listado|tickets?|casos?|reclamos?)\b/.test(
      norm,
    )
  ) {
    return false;
  }
  if (
    /^(una|unidad|patente|matricula|estado|reporte|gps|flota|lista|unidades|marca|nombre|chofer|conductor|mencionada|mencionado|anterior|consultando|hablando|hablamos|estamos|estoy|quiero|necesito|saber|decir|pasame|dame|ultima|ultimo|ubicacion|coordenadas|posicion)$/.test(
      norm,
    )
  ) {
    return false;
  }
  // "reporte de la", "estado de la", etc. — no son etiquetas de flota.
  const parts = norm.split(/\s+/).filter(Boolean);
  if (parts.some((p) => STOPWORDS.has(p) || /^(de|la|el|los|las|del|un|una|reporte|estado|gps|unidad|patente|matricula|ultima|ultimo|ubicacion|coordenadas|posicion)$/.test(p))) {
    return false;
  }
  if (detectLoosePlate(cand) || looksLikeUnitNameInMessage(cand)) return false;
  // Evitar frases / verbos conjugados comunes.
  if (
    /\b(que|porque|cuando|donde|como|necesito|quiero|estamos|estoy|consultando|hablando|mencionada|mencionado)\b/.test(
      norm,
    )
  ) {
    return false;
  }
  if (/(ando|endo|amos|emos|imos)$/.test(norm) && norm.length <= 12) return false;
  return true;
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
export function looksLikeVagueUnitReference(rawText: string): boolean {
  const norm = rawText
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (
    /\b(misma|mismo)\b.{0,40}\b(certificado|certficado)\b/.test(norm) ||
    /\bque me (?:diste|pasaste|mandaste) el certificado\b/.test(norm) ||
    /\b(unidad|patente)\b.{0,20}\b(del certificado|de el certificado)\b/.test(norm)
  ) {
    return true;
  }
  if (
    /\b(esa|ese|la misma|el mismo|esta misma|este mismo|la anterior|el anterior|la del hilo|la que dije|la que mencione|la que mencion[eé])\b/.test(
      norm,
    )
  ) {
    return true;
  }
  // Bug real, producción 2026-07-30: tras certificado/consulta GPS, "De esta patente" /
  // "Esta misma" al pedir cambio de odómetro no matcheaban referencia vaga — el agente
  // volvía a pedir matrícula en vez de reusar activeUnit.
  if (
    /\b(de esta|de esa|esta|esa)\s+(patente|matricula|unidad)\b/.test(norm) ||
    /\b(la misma|esta misma)\s+(patente|matricula|unidad)\b/.test(norm)
  ) {
    return true;
  }
  // Generalización (auditoría 2026-07-23, mismo patrón de listas cerradas de hoy):
  // "la unidad mencionada"/"el vehículo mencionado"/"dicha unidad"/"la unidad en
  // cuestión" son formas habituales de referirse a la unidad ya resuelta en el hilo,
  // no solo las frases exactas de arriba. Bug real: "dame el certificado de la unidad
  // mencionada" (tras resolver "la nissan" → AG 562 SP) no se reconocía como
  // referencia vaga y no reusaba la patente ya confirmada.
  if (
    /\b(unidad|vehiculo|veh[ií]culo|camion|patente)\s+(mencionada|mencionado|anterior|en cuestion|referida|referido)\b/.test(
      norm,
    ) ||
    /\b(dicha|dicho)\s+(unidad|vehiculo|veh[ií]culo|camion|patente)\b/.test(norm)
  ) {
    return true;
  }
  // Bug real, producción 2026-07-23: "la unidad que estamos hablando" y "es la unidad
  // por la que te consulté por reporte" (referencia a la unidad ya resuelta en OTRO
  // trámite, ej. una consulta de GPS/reporte previa) no matcheaban ninguna frase de
  // arriba — el bot terminaba pidiendo confirmar "la matrícula exacta" de una unidad
  // que el cliente ya había dejado clara por contexto, en vez de reusar esa unidad.
  if (
    /\b(?:la|el)\s+(?:(?:unidad|vehiculo|veh[ií]culo|camion|patente)\s+)?que\s+.{0,20}?\b(hablando|hablamos|hablabamos|consulte|consulto|pregunte|preguntaba|dije|mencione|hable)\b/.test(
      norm,
    )
  ) {
    return true;
  }
  if (
    /\b(?:por|de|sobre)\s+(?:la|el)\s+que\s+.{0,20}?\b(hablando|hablamos|hablabamos|consulte|consulto|pregunte|preguntaba|dije|mencione|hable|reporte|reportes)\b/.test(
      norm,
    )
  ) {
    return true;
  }
  return false;
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
  // Bug real, producción 2026-07-23: "te pedi un cambio de horometro" (corrección tras
  // misrouteo a GPS) aporta términos propios ("pedi") pero NO el identificador de
  // unidad — que quedó en un mensaje anterior del hilo ("M600-026"). Sin mezclar el
  // hilo, resolveUnitQuery no recupera la unidad ya mencionada.
  if (
    fromMessage.length > 0 &&
    !looksLikeVagueUnitReference(rawText) &&
    !looksLikeOdometerFlowReminder(rawText)
  ) {
    return fromMessage;
  }
  // Regresión encontrada en auditoría (2026-07-23): cuando el mensaje actual no aporta
  // NINGÚN término propio (p. ej. un saludo suelto: "hola, buenas", que queda vacío
  // tras filtrar STOPWORDS) y tampoco es una referencia vaga a una unidad ya resuelta
  // ("esa unidad", "la unidad mencionada"), no hay que mezclar el texto del hilo. Antes
  // de hoy esto era inofensivo porque filterUnitsBySearchTerms exigía matchear TODAS
  // las palabras sueltas del hilo (AND), lo que casi nunca coincidía por casualidad.
  // Al arreglar ese AND para ignorar ruido conversacional ("que pasa con la saveiro"),
  // un saludo sin ningún término propio pasó a "heredar" sin querer una patente vieja
  // mencionada antes en el mismo hilo por otro trámite (p. ej. "OST 223" quedaba
  // matcheando solo por aparecer en un mensaje anterior). Sin término propio y sin
  // referencia vaga explícita, no hay ninguna señal real de que el cliente esté
  // preguntando por una unidad — no corresponde buscar nada.
  if (fromMessage.length === 0 && !looksLikeVagueUnitReference(rawText)) {
    return fromMessage;
  }
  if (shouldAvoidThreadSearchTerms(rawText)) {
    return fromMessage;
  }
  return tokenizeSearchTerms(`${rawText} ${threadText}`.trim());
}

function filterUnitsBySearchTerms(units: WaraUnidadEstado[], terms: string[]): WaraUnidadEstado[] {
  if (!terms.length) return [];
  // Exigir que TODOS los términos matcheen (AND) rompe la búsqueda cuando el mensaje
  // trae una palabra de relleno que STOPWORDS no cubre (imposible enumerarlas todas —
  // mismo patrón de bug que las conjugaciones de "ayudar"). Bug real: "que pasa con la
  // saveiro" no resolvía porque "pasa" no está en ningún patente/unidad, aunque
  // "saveiro" sí matcheaba una unidad real. Se descartan primero los términos que no
  // aparecen en NINGUNA unidad de la flota (ruido conversacional) y se exige AND solo
  // sobre los términos que sí son "conocidos" por el catálogo real.
  //
  // El match contra el catálogo es por PALABRA COMPLETA (ver termMatchesWord), no por
  // substring de un string con todos los espacios pegados — eso causaba falsos
  // positivos (ver comentario en termMatchesWord, bug real 2026-07-28: "mas" de "más"
  // matcheaba "Mascotas" por casualidad).
  const unitsWithWords = units.map((unit) => ({ unit, words: haystackWordsForUnit(unit) }));
  const knownTerms = terms.filter((term) => {
    const norm = normalizeToken(term);
    if (!norm || norm.length < 3) return false;
    return unitsWithWords.some(({ words }) => words.some((w) => termMatchesWord(norm, w)));
  });
  if (!knownTerms.length) return [];
  return unitsWithWords
    .filter(({ words }) =>
      knownTerms.every((term) => words.some((w) => termMatchesWord(normalizeToken(term), w))),
    )
    .map(({ unit }) => unit);
}

function filterUnitsByPlate(units: WaraUnidadEstado[], plate: string): WaraUnidadEstado[] {
  const wanted = normalizeLoosePlate(plate);
  if (!wanted) return [];
  return units.filter((u) => {
    const unitPlate = normalizeLoosePlate(u.patente || u.unidad || "");
    if (!unitPlate) return false;
    if (unitPlate === wanted) return true;
    if (!isPlausibleVehiclePlate(wanted)) return false;
    return unitPlate.includes(wanted) || wanted.includes(unitPlate);
  });
}

function normalizeUnitNameToken(value: string): string {
  return value
    .replace(/[\u2010-\u2015\u2212]/g, "-") // guiones tipográficos → ASCII
    .replace(/[\s-]+/g, "")
    .toLowerCase();
}

/**
 * Códigos internos Wara: M300-097, 300-097.
 * Bug real 2026-08-06: "unidad 300-097" no puede perderse ante marca/IA
 * que invente patentes ajenas (AA251VD, AC093JO, …).
 *
 * Importante: "M600-170" NO debe matchear un label tipo "Tanda 600-170 backup"
 * (solo el código canónico con M, o el mismo token exacto).
 */
function unitNameCodesMatch(queryNorm: string, unitCode: string): boolean {
  if (!queryNorm || !unitCode) return false;
  if (queryNorm === unitCode) return true;
  // Cliente omitió la M (300-097 → M300-097). Solo si el código en Wara trae la M.
  if (!/^m\d/.test(queryNorm) && /^m\d/.test(unitCode) && unitCode === `m${queryNorm}`) {
    return true;
  }
  return false;
}

/** Códigos M600-170 / 300-092 presentes como token en el campo unidad de Wara. */
function unitNameCodesFromField(unidad: string): string[] {
  const tokens = new Set<string>();
  const field = String(unidad ?? "").replace(/[\u2010-\u2015\u2212]/g, "-");
  const normalized = normalizeUnitNameToken(field);
  if (normalized) tokens.add(normalized);
  for (const match of field.matchAll(/\b(M?\d{3}-\d{2,3})\b/gi)) {
    const code = normalizeUnitNameToken(match[1]);
    if (code) tokens.add(code);
  }
  return [...tokens];
}

/** Búsqueda por nombre de unidad (M600-170): coincidencia exacta de código, no substring suelto. */
export function filterUnitsByUnitName(units: WaraUnidadEstado[], query: string): WaraUnidadEstado[] {
  const norm = normalizeUnitNameToken(query);
  if (!norm) return [];
  return units.filter((u) => {
    const field = String(u.unidad || "").replace(/[\u2010-\u2015\u2212]/g, "-");
    const full = normalizeUnitNameToken(field);
    // Campo unidad ES exactamente el código (con o sin M), no un label largo con el número adentro.
    if (full && (full === norm || (!/^m\d/.test(norm) && full === `m${norm}`) || (/^m\d/.test(norm) && full === norm.slice(1)))) {
      return true;
    }
    return unitNameCodesFromField(field).some((code) => unitNameCodesMatch(norm, code));
  });
}

/** Código interno Wara en el mensaje (ej. "Unidad: M600-020", "interno M300-083"). */
export function extractExplicitUnitNameFromText(rawText: string): string | null {
  const text = String(rawText ?? "")
    .trim()
    .replace(/[\u2010-\u2015\u2212]/g, "-");
  if (!text) return null;
  const labeled = text.match(/\bunidad\s*(?:es\s*)?[:\-]?\s*(M?\d{3}-\d{2,3})\b/i);
  if (labeled?.[1]) return labeled[1];
  const interno = text.match(/\binterno\s*[:\-]?\s*(M?\d{3}-\d{2,3})\b/i);
  if (interno?.[1]) return interno[1];
  const bare = text.match(/\b(M?\d{3}-\d{2,3})\b/i);
  return bare?.[1] ?? null;
}

/** Cliente nombró un código de unidad distinto — no heredar patente del certificado/hilo. */
export function shouldClearOdometerPlateFromThread(rawText: string): boolean {
  const unitName = extractExplicitUnitNameFromText(rawText);
  return !!unitName && !detectLoosePlate(rawText);
}

function extractUnitNameFromText(rawText: string): string | null {
  return extractExplicitUnitNameFromText(rawText);
}

function resolveByUnitName(
  rawText: string,
  units: WaraUnidadEstado[],
): UnitQueryResolution | null {
  const unitName = extractUnitNameFromText(rawText);
  if (!unitName || !looksLikeUnitNameInMessage(rawText)) return null;
  const matches = filterUnitsByUnitName(units, unitName);
  if (matches.length === 1) {
    const plate = normalizeLoosePlate(matches[0].patente || matches[0].unidad || "");
    if (!plate) return null;
    return {
      intent: "consult_status",
      plate,
      searchTerms: [],
      candidatePlates: [plate],
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
      searchTerms: [],
      candidatePlates: matches
        .map((u) => normalizeLoosePlate(u.patente || u.unidad || ""))
        .filter(Boolean),
      clarificationQuestion: `Encontré ${matches.length} unidades con nombre parecido a ${unitName} (${labels}). Decime la matrícula exacta.`,
      source: "rules",
    };
  }
  return {
    intent: "need_clarification",
    searchTerms: [],
    candidatePlates: [],
    clarificationQuestion: buildFleetUnitNotFoundMessage({ rawText, searchedText: unitName }),
    source: "rules",
  };
}

/** Prefijo de patente en frases como "la que empieza con AG". */
function extractPlatePrefixHint(rawText: string): string | null {
  return extractPlatePrefixFromMessage(rawText);
}

/** Normaliza un prefijo ya razonado (IA / caller) a 2–4 chars alfanuméricos. */
function normalizePrefixHint(raw: string | null | undefined): string | null {
  const compact = String(raw ?? "")
    .trim()
    .replace(/[\s\-_.]+/g, "")
    .toUpperCase();
  if (!/^[A-Z0-9]{2,4}$/.test(compact)) return null;
  return compact;
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

  // Bug real detectado en auditoría (2026-07-23): cuando el mensaje de corrección
  // menciona DOS patentes completas en un mismo texto ("no es la OST 223, es la AD 427
  // MC"), extractPlateCorrectionHint puede capturar la RECHAZADA (la que sigue a "no la")
  // en vez de la CORREGIDA (la que sigue al "es la" posterior), porque sus patrones
  // regex priorizan la primera coincidencia de "no...la <token>". Si el texto trae dos
  // patentes completas y válidas, la corrección siempre es la última mencionada — el
  // cliente primero nombra lo que está mal y después aclara lo correcto.
  const allPlates = detectAllPlates(rawText);
  if (allPlates.length >= 2) {
    const correctedPlate = allPlates[allPlates.length - 1];
    const matches = filterUnitsByPlate(units, correctedPlate);
    if (matches.length === 1) {
      const plate = normalizeLoosePlate(matches[0].patente || matches[0].unidad || "") || correctedPlate;
      return {
        intent: "consult_status",
        plate,
        searchTerms: [],
        candidatePlates: [plate],
        source: "rules",
      };
    }
  }

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
  // Bug real / regresión 2026-08-06: "coordenadas de la última ubicación de la unidad AI 154 GD"
  // matcheaba "de la última" como hint de unidad y pisaba la patente explícita del mensaje.
  if (detectLoosePlate(rawText)) return null;
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

function extractCandidatePlatesFromThread(threadText: string): string[] {
  const lines = threadText.slice(-2500).split("\n").reverse();
  for (const line of lines) {
    const plates = extractPlatesFromClarificationMessage(line);
    if (plates.length >= 2) return plates;
  }
  return [];
}

/** Tras "Encontré 2 unidades (AI 329 TL, OOC 237)": resolver "termina con TL" / "comienza con AI". */
function resolveClarificationCandidateSelection(
  rawText: string,
  threadText: string,
): UnitQueryResolution | null {
  const candidates = extractCandidatePlatesFromThread(threadText);
  if (candidates.length < 2) return null;

  const prefix = extractPlatePrefixFromMessage(rawText);
  if (prefix) {
    const p = prefix.replace(/\s+/g, "").toUpperCase();
    const matches = candidates.filter((plate) => plate.startsWith(p));
    if (matches.length === 1) {
      return {
        intent: "consult_status",
        plate: matches[0],
        searchTerms: [],
        candidatePlates: [matches[0]],
        source: "rules",
      };
    }
    if (matches.length > 1) {
      const labels = matches.map((plate) => formatPlateWithSpaces(plate) ?? plate).join(", ");
      return {
        intent: "need_clarification",
        searchTerms: [],
        candidatePlates: matches,
        clarificationQuestion: `Encontré ${matches.length} unidades (${labels}). Decime la patente exacta.`,
        source: "rules",
      };
    }
  }

  const suffix = extractPlateSuffixFromMessage(rawText);
  if (suffix) {
    const s = suffix.replace(/\s+/g, "").toUpperCase();
    const matches = candidates.filter((plate) => plate.endsWith(s));
    if (matches.length === 1) {
      return {
        intent: "consult_status",
        plate: matches[0],
        searchTerms: [],
        candidatePlates: [matches[0]],
        source: "rules",
      };
    }
    if (matches.length > 1) {
      const labels = matches.map((plate) => formatPlateWithSpaces(plate) ?? plate).join(", ");
      return {
        intent: "need_clarification",
        searchTerms: [],
        candidatePlates: matches,
        clarificationQuestion: `Encontré ${matches.length} unidades (${labels}). Decime la patente exacta.`,
        source: "rules",
      };
    }
  }

  return null;
}

function resolveExplicitPlateInMessage(
  rawText: string,
  threadText: string,
  units: WaraUnidadEstado[],
): UnitQueryResolution | null {
  const threadPlate = extractLastPlateFromThread(threadText);
  const plateFromMessage =
    detectLoosePlate(rawText) ??
    (() => {
      const hint = extractPlateCorrectionHint(rawText);
      if (!hint) return null;
      if (isBarePlatePrefixHint(rawText) || extractPlatePrefixFromMessage(rawText)) return null;
      return hint;
    })() ??
    (shouldReuseThreadPlateForResolution(rawText) &&
    threadPlate &&
    isPlausibleVehiclePlate(threadPlate)
      ? threadPlate
      : null);
  if (!plateFromMessage) return null;

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

function extractPlatesFromClarificationMessage(text: string): string[] {
  const paren = text.match(/\(([^)]+)\)\s*\.?\s*(?:Decime|decime)/i);
  if (!paren?.[1]) return [];
  return paren[1]
    .split(/,\s*/)
    .map((part) => normalizeLoosePlate(part.trim()))
    .filter(Boolean);
}

/** "1" / "2" tras listado "Encontré 4 unidades (OST 223, OST 226...)". */
export function resolveNumericUnitSelection(rawText: string, threadText: string): string | null {
  const t = rawText.trim();
  if (!/^\d{1,2}$/.test(t)) return null;
  const idx = parseInt(t, 10) - 1;
  if (idx < 0) return null;
  const lines = threadText.slice(-2500).split("\n").reverse();
  for (const line of lines) {
    const plates = extractPlatesFromClarificationMessage(line);
    if (plates.length > 1 && idx < plates.length) return plates[idx];
  }
  return null;
}

function resolveWithRules(
  rawText: string,
  threadText: string,
  units: WaraUnidadEstado[]
): UnitQueryResolution {
  const numericPlate = resolveNumericUnitSelection(rawText, threadText);
  if (numericPlate) {
    const matches = filterUnitsByPlate(units, numericPlate);
    if (matches.length === 1) {
      const plate = normalizeLoosePlate(matches[0].patente || matches[0].unidad || "") || numericPlate;
      return {
        intent: "consult_status",
        plate,
        searchTerms: [],
        candidatePlates: [plate],
        source: "rules",
      };
    }
  }

  const clarificationPick = resolveClarificationCandidateSelection(rawText, threadText);
  if (clarificationPick) return clarificationPick;

  if (looksLikeUnitListRequest(rawText)) {
    return { intent: "list_fleet", searchTerms: [], candidatePlates: [], source: "rules" };
  }

  const correction = resolvePlateCorrection(rawText, units);
  if (correction) return correction;

  // Patente explícita en el mensaje antes que "de la <palabra>" / marca / nombre interno.
  // Bug real 2026-07-23 + regresión 2026-08-06: "última ubicación … unidad AI 154 GD"
  // no debe resolverse como búsqueda del literal «ULTIMA».
  const explicitPlateResolution = resolveExplicitPlateInMessage(rawText, threadText, units);
  if (explicitPlateResolution) return explicitPlateResolution;

  const unitSelection = resolveUnitSelectionHint(rawText, units);
  if (unitSelection) return unitSelection;

  if (looksLikeVehicleBrandOrUnitSearch(rawText)) {
    const brandResolution = resolveBrandOrNameInFleet(rawText, units);
    if (brandResolution) return brandResolution;
  }

  const unitNameResolution = resolveByUnitName(rawText, units);
  if (unitNameResolution) return unitNameResolution;

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
        clarificationQuestion: `Encontré ${prefixMatches.length} unidades que empiezan con ${prefixHint} (${labels}). ¿Cuál querés? Decime la patente completa.`,
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

  // Bug real, producción 2026-07-23: "300-092" / "M300-093" (formato de nombre de
  // unidad, sin letras suficientes para matchear como patente/prefijo) SÍ generaban
  // términos de búsqueda reales que simplemente no matchearon ninguna unidad de la
  // flota — pero se respondía con el "¿Cuál unidad?" genérico, como si el cliente no
  // hubiese escrito nada. No alcanza con "terms.length > 0": una queja con un typo
  // suelto ("tenmgo problemas con una unidad" → sobrevive "tenmgo") también deja
  // terms.length > 0 sin que el cliente haya dado ningún identificador real. La señal
  // más confiable es que el mensaje sea CORTO (1-2 palabras) — es decir, que sea
  // básicamente el propio identificador y no una oración con una palabra suelta.
  const rawWordCount = rawText.trim().split(/\s+/).filter(Boolean).length;
  const searchedLabel = extractExplicitUnitSearchLabel(rawText);
  const looksLikeIdentifierAttempt =
    (terms.length > 0 && rawWordCount <= 2) || !!searchedLabel;
  return {
    intent: "need_clarification",
    searchTerms: terms,
    candidatePlates: [],
    clarificationQuestion: buildFleetUnitNotFoundMessage(
      looksLikeIdentifierAttempt
        ? { rawText, searchedText: searchedLabel ?? rawText.trim() }
        : { rawText },
    ),
    source: "rules",
  };
}

async function resolveWithAi(
  rawText: string,
  threadText: string,
  units: WaraUnidadEstado[],
  opts?: { prefixHint?: string | null; maintenanceContext?: boolean; certificateContext?: boolean; odometerContext?: boolean },
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
    : opts?.odometerContext
      ? `
- CONTEXTO: el bot pidió la unidad para registrar cambio de ODÓMETRO u HORÓMETRO. El mensaje es selección de unidad (patente, prefijo como "la que empieza con RMX", marca o nombre).
- Resolvé prefijos y frases parciales SOLO contra el catálogo — NUNCA uses una patente del historial si el cliente indicó otro prefijo o unidad distinta en mensaje_nuevo.
- Si el historial dice que NO se encontró una marca (ej. Nissan) y mensaje_nuevo trae otra patente/prefijo/número, IGNORÁ la marca fallida — usá solo mensaje_nuevo.
- Una sola coincidencia clara → intent=consult_status con esa patente en candidatePlates.
- Varias coincidencias → intent=need_clarification listando patentes exactas del catálogo (hasta 8). PROHIBIDO tomar otra patente que no matchee lo pedido.
- "14:00" u hora del reloj NO es horómetro; horómetro = horas de motor.`
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
      if (looksLikeVehicleBrandOrUnitSearch(rawText)) {
        return true;
      }
      if (looksLikeLiveUnitConsultIntent(rawText)) {
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
  odometerContext?: boolean;
  /**
   * Prefijo ya razonado (p.ej. por utteranceUnderstanding). Si viene, las reglas
   * ejecutan la búsqueda en flota aunque el texto crudo no matchee regex.
   */
  prefixHint?: string | null;
  /**
   * Nombre/marca/etiqueta ya razonada (IA o texto libre: "Altamiranda").
   * Busca en patente+unidad sin exigir catálogo cerrado de marcas.
   */
  nameHint?: string | null;
  /**
   * Historial "solo cliente" para el prompt de la IA (ver `buildCustomerOnlyText`).
   * Si no se pasa, se usa `threadText` tal cual (compatibilidad con callers que no
   * tienen acceso a la base, p.ej. tests). Las reglas determinísticas SIEMPRE usan
   * `threadText` completo — esto solo afecta qué ve la IA como "historial".
   */
  aiHistorial?: string;
}): Promise<UnitQueryResolution> {
  if (looksLikeOdometerConfirmationRejection(params.rawText)) {
    return {
      intent: "need_clarification",
      searchTerms: [],
      candidatePlates: [],
      source: "rules",
    };
  }

  const clarificationPick = resolveClarificationCandidateSelection(params.rawText, params.threadText);
  if (clarificationPick) return clarificationPick;

  const historialForAi = params.aiHistorial ?? params.threadText;
  const overridePrefix = normalizePrefixHint(params.prefixHint);
  const prefixHint = overridePrefix ?? prefixHintFromMessage(params.rawText);

  // Código interno (300-097 / M300-097) ANTES que marca/nameHint/IA.
  // Bug real 2026-08-06: "Tengo la unidad 300-097 sin reporte" → nameResEarly/IA
  // devolvía 3 patentes ajenas (AA251VD, AC093JO, AB042BD) en vez de la unidad.
  if (looksLikeUnitNameInMessage(params.rawText)) {
    const unitNameEarly = resolveByUnitName(params.rawText, params.units);
    if (unitNameEarly) return unitNameEarly;
  }
  // nameHint que es código interno (no apellido/marca) → misma resolución exacta.
  if (params.nameHint && looksLikeUnitNameInMessage(params.nameHint)) {
    const byHint = filterUnitsByUnitName(params.units, params.nameHint.trim());
    if (byHint.length === 1) {
      const plate = normalizeLoosePlate(byHint[0].patente || byHint[0].unidad || "");
      if (plate) {
        return {
          intent: "consult_status",
          plate,
          searchTerms: [],
          candidatePlates: [plate],
          source: "rules",
        };
      }
    }
    if (byHint.length > 1) {
      const labels = byHint
        .slice(0, 5)
        .map((u) => (u.patente || u.unidad || "").trim())
        .join(", ");
      return {
        intent: "need_clarification",
        searchTerms: [],
        candidatePlates: byHint
          .map((u) => normalizeLoosePlate(u.patente || u.unidad || ""))
          .filter(Boolean),
        clarificationQuestion: `Encontré ${byHint.length} unidades con nombre parecido a ${params.nameHint} (${labels}). Decime la matrícula exacta.`,
        source: "rules",
      };
    }
    return {
      intent: "need_clarification",
      searchTerms: [],
      candidatePlates: [],
      clarificationQuestion: buildFleetUnitNotFoundMessage({
        rawText: params.rawText,
        searchedText: params.nameHint.trim(),
      }),
      source: "rules",
    };
  }

  // Prefijo razonado (IA u override) → ejecutar búsqueda en flota YA, sin depender del typo.
  // No pisar un código interno ya presente en el mensaje.
  if (overridePrefix && !looksLikeUnitNameInMessage(params.rawText)) {
    const prefixMatches = filterUnitsByPlatePrefix(params.units, overridePrefix);
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
        clarificationQuestion: `Encontré ${prefixMatches.length} unidades que empiezan con ${overridePrefix} (${labels}). ¿Cuál querés? Decime la patente completa.`,
        source: "rules",
      };
    }
    return {
      intent: "need_clarification",
      searchTerms: [],
      candidatePlates: [],
      clarificationQuestion: buildFleetUnitNotFoundMessage({
        rawText: params.rawText,
        prefix: overridePrefix,
      }),
      source: "rules",
    };
  }

  // Nombre/etiqueta libre (Altamiranda, Nissan, …) antes de pedir patente.
  // No anteponer a referencias vagas del hilo ("la unidad mencionada").
  const nameResEarly =
    looksLikeVagueUnitReference(params.rawText) || detectLoosePlate(params.rawText)
      ? null
      : resolveBrandOrNameInFleet(params.rawText, params.units, params.nameHint);
  if (nameResEarly?.intent === "consult_status" && nameResEarly.plate) return nameResEarly;
  if (
    nameResEarly?.intent === "need_clarification" &&
    (nameResEarly.candidatePlates.length > 0 ||
      !!params.nameHint?.trim() ||
      !!extractFreeTextUnitSearchCandidate(params.rawText))
  ) {
    return nameResEarly;
  }

  const brandOrLiveConsult =
    looksLikeVehicleBrandOrUnitSearch(params.rawText) ||
    !!extractFreeTextUnitSearchCandidate(params.rawText) ||
    looksLikeLiveUnitConsultIntent(params.rawText);
  const certificateCtx =
    params.certificateContext || hasCertificateFlowAwaitingUnit(params.threadText);
  const odometerCtx =
    params.odometerContext ||
    threadAwaitingOdometerPlate(params.threadText) ||
    threadAwaitingHorometerPlate(params.threadText);
  const shouldPreferAi =
    params.preferAi ||
    params.maintenanceContext ||
    certificateCtx ||
    odometerCtx ||
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

  // Bug real, producción 2026-07-23: "Me podrías dar las coordenadas de la última
  // ubicación de la unidad AI 154 GD" trae una patente EXPLÍCITA y con formato válido
  // en el propio mensaje, pero como también es una "consulta en vivo" (coordenadas/
  // ubicación), `shouldPreferAi` se activaba y la IA respondía primero — con un
  // catálogo recortado (120 de 414 unidades de esta flota) que no necesariamente
  // incluye esa patente. El bot terminaba pidiendo "¿Cuál unidad?" genérico como si el
  // cliente no hubiese dicho nada, cuando en realidad dio una patente concreta que las
  // reglas (que sí miran la flota COMPLETA) pueden resolver o rechazar de forma
  // decisiva. Una patente explícita en el mensaje actual siempre se resuelve primero
  // contra el catálogo real (antes que marca/nombre libre).
  const explicitPlateInMessage = detectLoosePlate(params.rawText);
  const numericPlate = resolveNumericUnitSelection(params.rawText, params.threadText);
  if (explicitPlateInMessage || numericPlate) {
    const plateRules = resolveWithRules(params.rawText, params.threadText, params.units);
    if (plateRules.intent === "consult_status" && plateRules.plate) return plateRules;
    if (
      plateRules.intent === "need_clarification" &&
      plateRules.candidatePlates.length === 0 &&
      plateRules.clarificationQuestion
    ) {
      return plateRules;
    }
  }

  // Marca/nombre (Nissan, Saveiro, Altamiranda, etc.) contra el catálogo real.
  if (looksLikeVehicleBrandOrUnitSearch(params.rawText) || !!extractFreeTextUnitSearchCandidate(params.rawText)) {
    const brandRules = resolveBrandOrNameInFleet(params.rawText, params.units, params.nameHint);
    if (brandRules) return brandRules;
  }

  // Nombre de unidad explícito (M600-170): reglas contra catálogo completo antes que IA.
  if (looksLikeUnitNameInMessage(params.rawText)) {
    const unitNameRules = resolveByUnitName(params.rawText, params.units);
    if (unitNameRules) return unitNameRules;
  }

  const rulesOnlyOdometer =
    odometerCtx &&
    (explicitPlateInMessage ||
      numericPlate ||
      !!prefixHint ||
      isBarePlatePrefixHint(params.rawText) ||
      (threadHasFailedUnitSearch(params.threadText) &&
        !looksLikeVehicleBrandOrUnitSearch(params.rawText)));
  if (rulesOnlyOdometer) {
    const rulesOnly = resolveWithRules(params.rawText, params.threadText, params.units);
    if (rulesOnly.intent === "consult_status" && rulesOnly.plate) return rulesOnly;
    if (rulesOnly.intent === "need_clarification" && rulesOnly.clarificationQuestion) {
      return rulesOnly;
    }
  }

  if (shouldPreferAi && process.env.OPENAI_API_KEY?.trim()) {
    const aiFirst = await resolveWithAi(params.rawText, historialForAi, params.units, {
      prefixHint,
      maintenanceContext: !!params.maintenanceContext,
      certificateContext: certificateCtx,
      odometerContext: odometerCtx,
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

  const ai = await resolveWithAi(params.rawText, historialForAi, params.units, {
    prefixHint,
    maintenanceContext: !!params.maintenanceContext,
    certificateContext: certificateCtx,
    odometerContext: odometerCtx,
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
  odometerContext?: boolean;
};

/** Resuelve patente desde texto + flota Wara (IA/reglas). Uso compartido en todos los trámites. */
export function shouldBypassDirectPlateForFleetLookup(
  rawText: string,
  directPlate?: string | null,
): boolean {
  if (!directPlate?.trim()) return false;
  const plateInMessage = detectLoosePlate(rawText);
  if (plateInMessage && normalizePlate(plateInMessage) === normalizePlate(directPlate)) {
    return false;
  }
  if (extractPlatePrefixFromMessage(rawText)) return true;
  if (looksLikePlateCorrectionRequest(rawText)) return true;
  if (looksLikeFleetUnitSearchInput(rawText) && !plateInMessage) return true;
  return false;
}

export async function resolvePlateWithWaraFleet(
  prisma: PrismaClient,
  rawPhone: string,
  rawText: string,
  threadText: string,
  directPlate?: string | null,
  opts?: ResolvePlateWithWaraFleetOptions,
): Promise<PlateFromFleetResult> {
  const normalizedDirect =
    directPlate && !shouldBypassDirectPlateForFleetLookup(rawText, directPlate)
      ? normalizePlate(directPlate)
      : null;
  if (normalizedDirect) {
    return { ok: true, plate: normalizedDirect, source: "direct" };
  }

  if (
    looksLikeOdometerConfirmationRejection(rawText) &&
    hasPendingOdometerConfirmation(threadText)
  ) {
    return { ok: false, reason: "not_found" };
  }

  // Arranque de trámite sin unidad ("quiero cambiar el odómetro") → no buscar flota aún.
  // Si en el mismo mensaje hay marca/prefijo/patente ("cambiar horómetro de la Nissan"),
  // SÍ hay que resolver contra la flota.
  if (
    (looksLikeOdometerIntentStart(rawText) || looksLikeOdometerHelpRequest(rawText)) &&
    !detectLoosePlate(rawText) &&
    !looksLikeFleetUnitSearchInput(rawText)
  ) {
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
  const aiHistorial = threadTextSinceCompanySelection(await customerOnlyThreadText(prisma, rawPhone));
  const resolved = await resolveUnitQuery({
    rawText,
    threadText: scopedThread,
    units: fleet.unidades,
    preferAi: opts?.preferAi || opts?.maintenanceContext || opts?.certificateContext || opts?.odometerContext,
    maintenanceContext: opts?.maintenanceContext,
    certificateContext: opts?.certificateContext,
    odometerContext: opts?.odometerContext,
    aiHistorial,
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

/** Marca/prefijo/nombre/patente parcial → executor unidades (búsqueda en flota), no agente. */
export function shouldRouteTurnToUnidadesExecutor(params: {
  selectionText: string;
  threadText: string;
}): boolean {
  const { selectionText, threadText } = params;
  if (
    looksLikeExplicitOdometerUpdateRequest(selectionText) ||
    looksLikeHorometerOnlyIntent(selectionText)
  ) {
    return false;
  }

  // GPS/reporte en vivo — siempre al executor (no exige patente/marca en el mensaje).
  if (
    looksLikeLiveUnitConsultIntent(selectionText) ||
    looksLikeGpsOrUnitStatusQuestion(selectionText)
  ) {
    return true;
  }

  // Señal concreta de unidad (prefijo, patente, marca, nombre/etiqueta de flota) → flota.
  if (
    !!extractPlatePrefixFromMessage(selectionText) ||
    isBarePlatePrefixHint(selectionText) ||
    !!detectLoosePlate(selectionText) ||
    looksLikeVehicleBrandOrUnitSearch(selectionText) ||
    looksLikeUnitNameInMessage(selectionText) ||
    !!extractFreeTextUnitSearchCandidate(selectionText)
  ) {
    return true;
  }

  // Tras pedir síntoma o con unidad en hilo: referencia vaga o patente explícita.
  if (
    threadHasRecentUnitProblemListenPrompt(threadText) &&
    (looksLikeVagueUnitReference(selectionText) ||
      looksLikeUnitReportingStatusCue(selectionText) ||
      !!detectLoosePlate(selectionText))
  ) {
    return true;
  }

  if (
    looksLikeVagueUnitReference(selectionText) &&
    (extractLastPlateFromThread(threadText) ||
      threadHasRecentLiveUnitConsultIntent(threadText) ||
      /\bcertificado\b/i.test(threadText))
  ) {
    return true;
  }

  if (!looksLikeFleetUnitSearchInput(selectionText)) return false;
  if (looksLikeUnitListRequest(selectionText)) return false;
  if (hasPendingUnitConsultPlateRequest(threadText)) return true;
  if (threadHasRecentLiveUnitConsultIntent(threadText)) return true;
  return false;
}

/**
 * Turno que debe ir al executor de odómetro (no agente/consulta GPS) porque el trámite sigue activo.
 */
export function shouldRouteTurnToOdometerExecutor(params: {
  selectionText: string;
  threadText: string;
  pendingActionType?: string | null;
}): boolean {
  const { selectionText, threadText, pendingActionType } = params;
  if (threadOdometerRegistrationCompleted(threadText)) return false;
  // Con pending de odómetro el trámite sigue vivo aunque el hilo dispare un falso
  // "superseded" (bug 2026-08-06: pedido de fecha/hora con "necesito").
  if (isOdometerFlowSuperseded(threadText) && pendingActionType !== "odometro") return false;
  // Bug real 2026-08-03: patente tras "otra unidad sin reporte" no es odómetro.
  if (
    hasPendingUnitConsultPlateRequest(threadText) &&
    !looksLikeExplicitOdometerUpdateRequest(selectionText) &&
    !looksLikeHorometerOnlyIntent(selectionText)
  ) {
    return false;
  }

  // Arranque explícito (p. ej. tras consulta GPS/mantenimiento) → executor aunque no haya flujo activo previo.
  if (
    looksLikeExplicitOdometerUpdateRequest(selectionText) ||
    looksLikeHorometerOnlyIntent(selectionText)
  ) {
    return true;
  }

  const flowActive =
    pendingActionType === "odometro" ||
    threadHasActiveOdometerFlow(threadText) ||
    threadAwaitingOdometerKmValue(threadText) ||
    threadAwaitingHorometerKmValue(threadText) ||
    hasPendingOdometerConfirmation(threadText);

  if (!flowActive) return false;
  if (looksLikeFlowControlCommand(selectionText)) return false;
  if (looksLikeGpsOrUnitStatusQuestion(selectionText) || looksLikeLiveUnitConsultIntent(selectionText)) {
    return false;
  }

  if (threadAwaitingOdometerKmValue(threadText) || threadAwaitingHorometerKmValue(threadText)) {
    return true;
  }
  if (pendingActionType === "odometro") return true;
  if (isOdometerPlateSelectionMessage(selectionText)) return true;
  if (
    threadHasOdometerUnitClarificationPending(threadText) &&
    looksLikeSubstantiveCustomerMessage(selectionText)
  ) {
    return true;
  }
  if (
    (threadAwaitingOdometerPlate(threadText) || threadAwaitingHorometerPlate(threadText)) &&
    looksLikeSubstantiveCustomerMessage(selectionText)
  ) {
    return true;
  }
  // Referencia vaga mientras el bot pidió patente para odómetro (p. ej. "De esta patente"
  // tras certificado) — no dejar que el agente pida matrícula otra vez.
  const tail = threadText.slice(-2500).toLowerCase();
  if (
    looksLikeVagueUnitReference(selectionText) &&
    /para registrar el cambio de od[oó]metro necesito la patente|para registrar el cambio de hor[oó]metro necesito la patente/.test(
      tail,
    ) &&
    !threadOdometerRegistrationCompleted(threadText)
  ) {
    return true;
  }
  return false;
}

export {
  looksLikeUnitListRequest,
  filterUnitsBySearchTerms,
  fuzzyMatchUnitByPlate,
  reconcileAiClarification,
  filterAiCandidatesByFleetTerms,
  buildCustomerOnlyText,
  customerOnlyThreadText,
};
