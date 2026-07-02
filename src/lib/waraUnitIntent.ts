import OpenAI from "openai";
import { detectPlate, normalizePlate } from "@/lib/wara";
import type { WaraUnidadEstado } from "@/lib/waraApi";

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

function compactUnitsForAi(units: WaraUnidadEstado[], limit = 120): Array<{ movil_id: number; patente: string; unidad: string }> {
  return units.slice(0, limit).map((u) => ({
    movil_id: u.movil_id,
    patente: (u.patente ?? "").trim(),
    unidad: (u.unidad ?? "").trim(),
  }));
}

function looksLikeUnitListRequest(rawText: string): boolean {
  const norm = rawText
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (detectPlate(rawText)) return false;
  return /\b(listado|lista de unidad|lista de unidades|listame|pasame la lista|p[aá]same la lista|me pasas la lista|dame la lista|ver lista|mis unidades|todas las unidades|todas mis unidades|reporte de mis unidades|reporte de las unidades|flota|cuantas unidades|cu[aá]ntas unidades|ver unidades|mis camiones|que unidades|qu[eé] unidades|unidades que cuento|cuantas tengo|cu[aá]ntas tengo|cuento en wara|cuento en la plataforma)\b/.test(
    norm
  );
}

function extractSearchTerms(rawText: string, threadText: string): string[] {
  const blob = `${rawText} ${threadText}`.trim();
  const tokens = blob
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
  return Array.from(new Set(tokens));
}

function filterUnitsBySearchTerms(units: WaraUnidadEstado[], terms: string[]): WaraUnidadEstado[] {
  if (!terms.length) return [];
  return units.filter((unit) => {
    const haystack = normalizeToken(`${unit.patente ?? ""} ${unit.unidad ?? ""}`);
    return terms.some((term) => {
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

function resolveWithRules(
  rawText: string,
  threadText: string,
  units: WaraUnidadEstado[]
): UnitQueryResolution {
  if (looksLikeUnitListRequest(rawText)) {
    return { intent: "list_fleet", searchTerms: [], candidatePlates: [], source: "rules" };
  }

  const plateFromMessage = detectPlate(rawText) ?? detectPlate(threadText) ?? "";
  if (plateFromMessage) {
    const plate = normalizeLoosePlate(plateFromMessage);
    const matches = filterUnitsByPlate(units, plate);
    return {
      intent: matches.length === 1 ? "consult_status" : matches.length > 1 ? "need_clarification" : "consult_status",
      plate,
      searchTerms: [],
      candidatePlates: matches.map((u) => normalizeLoosePlate(u.patente || u.unidad || "")).filter(Boolean),
      clarificationQuestion:
        matches.length > 1
          ? `Encontré varias unidades parecidas a ${plateFromMessage}. Decime la matrícula exacta.`
          : undefined,
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
    intent: "consult_status",
    searchTerms: terms,
    candidatePlates: [],
    source: "rules",
  };
}

async function resolveWithAi(
  rawText: string,
  threadText: string,
  units: WaraUnidadEstado[]
): Promise<UnitQueryResolution | null> {
  if (!process.env.OPENAI_API_KEY?.trim()) return null;

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const catalog = compactUnitsForAi(units);

  const system = `Sos el resolvedor de consultas de unidades Wara para WhatsApp.
Devolvé SOLO JSON válido (sin markdown) con esta forma:
{"intent":"list_fleet"|"consult_status"|"need_clarification","candidatePlates":["AE483VE"],"clarificationQuestion":null}
Reglas:
- intent=list_fleet si piden listado/flota/cuántas unidades/cuento en wara.
- intent=consult_status si quieren estado/reporte de una unidad concreta o certificado de cobertura de una unidad (marca, nombre o patente).
- candidatePlates: SOLO patentes que existan en el catálogo (sin espacios, mayúsculas).
- Si hay varias coincidencias razonables (marca, nombre parcial), intent=need_clarification y pregunta breve en español rioplatense.
- Nunca inventes patentes fuera del catálogo.
- Si no hay match claro y no es listado, intent=need_clarification pidiendo matrícula o nombre exacto.`;

  const user = JSON.stringify({
    mensaje: rawText,
    historial: threadText.slice(-2000),
    catalogo: catalog,
  });

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.1,
      max_tokens: 300,
      response_format: { type: "json_object" },
    });

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
      return {
        intent,
        searchTerms: [],
        candidatePlates,
        clarificationQuestion:
          parsed.clarificationQuestion?.trim() ||
          "¿Me pasás la matrícula exacta o el nombre de la unidad para consultarla en Wara?",
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

export async function resolveUnitQuery(params: {
  rawText: string;
  threadText: string;
  units: WaraUnidadEstado[];
}): Promise<UnitQueryResolution> {
  const ai = await resolveWithAi(params.rawText, params.threadText, params.units);
  if (ai) return ai;
  return resolveWithRules(params.rawText, params.threadText, params.units);
}

export function filterUnitsByResolvedPlate(units: WaraUnidadEstado[], plate: string): WaraUnidadEstado[] {
  return filterUnitsByPlate(units, plate);
}

export { looksLikeUnitListRequest, filterUnitsBySearchTerms };
