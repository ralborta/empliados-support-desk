/**
 * Capa de interpretación semántica de búsqueda de unidades (V2).
 * Reglas determinísticas primero; salida tipada validada con Zod.
 * El LLM opcional enriquece en utterance-understanding-v2.ts.
 */
import { z } from "zod";
import {
  looksLikeGpsReportRequest,
  parseContextualListRef,
  parseNumericListSelection,
  parseOrdinalListSelection,
} from "./brief-replies.js";
import { detectLoosePlate } from "./plates.js";
import { extractUnitNameCode } from "./unit-fleet.js";
import {
  extractPartialPlateToken,
  extractPlateContainsFromMessage,
  extractPlatePrefixFromMessage,
  extractPlateSuffixFromMessage,
  isBarePlatePrefixHint,
} from "./plate-prefix.js";
import type { PaginatedFleetListing } from "./unit-fleet.js";
import type { FleetUnitRef } from "./unit-fleet.js";
import { SERVICE_FILLER_WORDS } from "./service-catalog.js";

const NON_NAME_FILLER = new Set([
  "reporte", "informe", "estado", "gps", "unidad", "unidades", "patente", "patentes", "para", "por",
  ...SERVICE_FILLER_WORDS,
]);

export const UnitSearchIntentSchema = z.enum([
  "unit_status",
  "find_unit",
  "select_index",
  "contextual_ref",
]);

export const UnitSearchEntitySchema = z.enum(["license_plate", "unit_name", "brand"]);

export const UnitMatchModeSchema = z.enum([
  "exact",
  "prefix",
  "suffix",
  "contains",
  "index",
  "contextual",
]);

export const UnitSearchInterpretationSchema = z.object({
  intent: UnitSearchIntentSchema,
  entity: UnitSearchEntitySchema,
  matchMode: UnitMatchModeSchema,
  query: z.string().min(1).max(40),
  confidence: z.enum(["high", "medium", "low"]),
  source: z.enum(["rules", "llm"]),
  index: z.number().int().positive().optional(),
  contextualKind: z
    .enum(["selected", "previous", "next", "first_on_page", "last_on_page"])
    .optional(),
});

export type UnitSearchInterpretation = z.infer<typeof UnitSearchInterpretationSchema>;

export function validateUnitSearchInterpretation(raw: unknown): UnitSearchInterpretation | null {
  const parsed = UnitSearchInterpretationSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function normalizeForRules(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\bpatent(?:re|nte|e)\b/gi, "patente")
    .replace(/\bdominio\b/gi, "patente")
    .replace(/\bmovil\b/gi, "unidad")
    .replace(/\bmobile\b/gi, "unidad")
    .trim();
}

function looksLikeFindUnitRequest(text: string): boolean {
  const n = normalizeForRules(text).toLowerCase();
  if (!n) return false;
  if (/\b(buscame|busca|buscar|mostrame|mostrar|listame|listar|dame|pasame|encontra)\b/.test(n)) {
    return true;
  }
  if (/\b(alguna|algunas|cuales|cuantas)\b/.test(n) && /\b(patente|unidad|movil)\b/.test(n)) {
    return true;
  }
  if (/\b(patentes?)\b/.test(n) && !looksLikeGpsReportRequest(text)) {
    return /\b(con|que|arranc|empiez|termin|tengan|contien)\b/.test(n);
  }
  return false;
}

function inferIntent(text: string): UnitSearchInterpretation["intent"] {
  if (looksLikeGpsReportRequest(text)) return "unit_status";
  if (looksLikeFindUnitRequest(text)) return "find_unit";
  return "find_unit";
}

export type InterpretRulesContext = {
  lastListing?: PaginatedFleetListing | null;
  selectedUnit?: FleetUnitRef | null;
  listingFresh?: boolean;
};

/** Interpretación determinística del mensaje (sin LLM). */
export function interpretUnitSearchRules(
  rawText: string,
  ctx: InterpretRulesContext = {},
): UnitSearchInterpretation | null {
  const text = normalizeForRules(rawText);
  if (!text) return null;

  // Nunca interpretar un servicio operativo como búsqueda de unidad.
  const lower = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if ([...SERVICE_FILLER_WORDS].some((w) => new RegExp(`\\b${w}\\b`).test(lower))) {
    return null;
  }

  const ordinal = parseOrdinalListSelection(text);
  if (ordinal != null && ctx.listingFresh) {
    return {
      intent: "select_index",
      entity: "license_plate",
      matchMode: "index",
      query: String(ordinal),
      index: ordinal,
      confidence: "high",
      source: "rules",
    };
  }

  const numeric = parseNumericListSelection(text);
  if (numeric != null && ctx.listingFresh) {
    return {
      intent: "select_index",
      entity: "license_plate",
      matchMode: "index",
      query: String(numeric),
      index: numeric,
      confidence: "high",
      source: "rules",
    };
  }

  const contextual = parseContextualListRef(text, {
    hasListing: ctx.listingFresh ?? false,
    hasSelected: Boolean(ctx.selectedUnit),
  });
  if (contextual) {
    return {
      intent: contextual.wantsStatus ? "unit_status" : "contextual_ref",
      entity: "license_plate",
      matchMode: "contextual",
      query: contextual.kind,
      contextualKind: contextual.kind,
      confidence: "high",
      source: "rules",
    };
  }

  const unitCode = extractUnitNameCode(text);
  if (unitCode) {
    return {
      intent: inferIntent(text),
      entity: "unit_name",
      matchMode: "exact",
      query: unitCode,
      confidence: "high",
      source: "rules",
    };
  }

  const plate = detectLoosePlate(text);
  if (plate) {
    return {
      intent: inferIntent(text),
      entity: "license_plate",
      matchMode: "exact",
      query: plate,
      confidence: "high",
      source: "rules",
    };
  }

  const contains = extractPlateContainsFromMessage(text);
  if (contains) {
    return {
      intent: inferIntent(text),
      entity: "license_plate",
      matchMode: "contains",
      query: contains,
      confidence: "high",
      source: "rules",
    };
  }

  const suffix = extractPlateSuffixFromMessage(text);
  if (suffix) {
    return {
      intent: inferIntent(text),
      entity: "license_plate",
      matchMode: "suffix",
      query: suffix,
      confidence: "high",
      source: "rules",
    };
  }

  const prefix = extractPlatePrefixFromMessage(text);
  if (prefix) {
    return {
      intent: inferIntent(text),
      entity: "license_plate",
      matchMode: "prefix",
      query: prefix,
      confidence: "high",
      source: "rules",
    };
  }

  const partial = extractPartialPlateToken(text);
  if (partial) {
    return {
      intent: inferIntent(text),
      entity: "license_plate",
      matchMode: "prefix",
      query: partial,
      confidence: "high",
      source: "rules",
    };
  }

  if (isBarePlatePrefixHint(text)) {
    const compact = text
      .trim()
      .replace(/^(la|el|esa|ese)\s+/i, "")
      .replace(/[\s\-_.]+/g, "")
      .toUpperCase();
    return {
      intent: inferIntent(text),
      entity: "license_plate",
      matchMode: "prefix",
      query: compact,
      confidence: "high",
      source: "rules",
    };
  }

  const bareName = text
    .replace(/\b(reporte|informe|estado|gps|de|la|el|unidad|unidades|quiero|dame|pasame|decime)\b/gi, " ")
    .trim();
  if (bareName.length >= 3 && bareName.length <= 32 && !/\d{3,}/.test(bareName)) {
    const tokens = bareName
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length >= 3 && !NON_NAME_FILLER.has(t));
    if (tokens.length >= 1 && tokens.length <= 3) {
      return {
        intent: inferIntent(text),
        entity: "unit_name",
        matchMode: "exact",
        query: tokens.join(" "),
        confidence: "medium",
        source: "rules",
      };
    }
  }

  return null;
}

/** Fusiona interpretación LLM validada sobre reglas (reglas ganan si confianza alta). */
export function mergeInterpretations(
  rules: UnitSearchInterpretation | null,
  llm: UnitSearchInterpretation | null,
): UnitSearchInterpretation | null {
  if (!llm) return rules;
  if (!rules) return llm;
  if (rules.confidence === "high") return rules;
  if (llm.confidence === "high") return llm;
  return rules;
}
