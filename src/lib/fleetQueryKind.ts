/**
 * Modelo de consultas sobre flota/unidades — tres familias operativas.
 *
 * Contrato de estado (no muta pendingAction/activeUnit):
 * - individual_unit: consulta Wara de UNA unidad (con o sin identificador aún).
 * - fleet_list: catálogo/listado de flota.
 * - aggregate_comparison: ranking/comparación entre dos o más unidades — NO soportado;
 *   respuesta fija (solo unidad por unidad).
 */
import { detectAllPlates, detectLoosePlate, detectPlate } from "@/lib/wara";

export type FleetQueryKind =
  | "individual_unit"
  | "fleet_list"
  | "aggregate_comparison"
  | "none";

export type FleetQueryScope = "single_unit" | "fleet_catalog" | "cross_fleet_metric" | "other";

export type FleetQueryClassification = {
  kind: FleetQueryKind;
  scope: FleetQueryScope;
  hasUnitIdentifier: boolean;
  isComparativeQuestion: boolean;
};

/** Contrato documentado para tests, logs y auditoría. */
export const FLEET_QUERY_STATE_CONTRACT = {
  version: "2026-08-24",
  kinds: {
    individual_unit:
      "Consulta en vivo por una unidad; si falta identificador, pedir patente/marca/código (no ranking).",
    fleet_list: "Listado de flota; no exige patente previa.",
    aggregate_comparison:
      "Comparación/ranking entre dos o más unidades (con o sin patentes); respuesta fija de límite + oferta individual/listado.",
  },
  capability_override: {
    wins_over: ["prior_thread_topic", "aggregate_clarify", "utterance_ranking_hallucination"],
    preserves: ["pendingAction", "activeUnit", "pendingConfirmation"],
  },
} as const;

function normFleetQueryText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function hasConcreteUnitIdentifier(text: string, norm: string): boolean {
  if (detectLoosePlate(text) || detectPlate(text)) return true;
  if (/\bM?\d{3}-\d{3}\b/i.test(text)) return true;
  if (/\binterno\s+\d{5,7}\b/i.test(norm)) return true;
  if (/\b(prefijo|empieza|termina|arranca)\b/.test(norm) && /\b[A-Z]{2,3}\b/i.test(text)) {
    return true;
  }
  return false;
}

/** Cuenta identificadores concretos distintos (patentes, internos, códigos Mxxx-xxx). */
function countConcreteUnitIdentifiers(text: string, norm: string): number {
  const ids = new Set<string>();
  for (const plate of detectAllPlates(text)) {
    ids.add(`plate:${plate}`);
  }
  const loose = detectLoosePlate(text) ?? detectPlate(text);
  if (loose) ids.add(`plate:${loose}`);

  for (const m of text.matchAll(/\bM?\d{3}-\d{3}\b/gi)) {
    ids.add(`code:${m[0].toUpperCase()}`);
  }
  for (const m of norm.matchAll(/\binterno\s+(\d{5,7})\b/g)) {
    ids.add(`interno:${m[1]}`);
  }
  return ids.size;
}

function isFleetListRequest(norm: string): boolean {
  if (/\b(listado|listame|list[aá]me)\b/.test(norm) && /\b(unidades|flota|camiones)\b/.test(norm)) {
    return true;
  }
  if (/\b(todas las unidades|mis unidades|cu[aá]ntas unidades|ver toda la flota)\b/.test(norm)) {
    return true;
  }
  if (/\b(pasame|p[aá]same|dame|mostr[aá]me|decime|dec[ií]me)\b/.test(norm) && /\blist/.test(norm)) {
    return true;
  }
  return false;
}

/**
 * Comparación entre dos o más unidades (con patentes o referencia anafórica).
 * Debe evaluarse ANTES de forzar individual_unit por presencia de patente.
 */
function isMultiUnitComparisonRequest(raw: string, norm: string): boolean {
  if (isFleetListRequest(norm)) return false;

  const idCount = countConcreteUnitIdentifiers(raw, norm);

  const compareVerb =
    /\b(comparar|comparame|compar[aá]|comparacion|versus|vs\.?)\b/.test(norm) ||
    /\bdiferencia\b/.test(norm);

  const betweenCue =
    /\bentre\b/.test(norm) ||
    /\bcon\b/.test(norm) ||
    /\b(y|o)\b/.test(norm);

  const multiUnitCue =
    /\b(dos|ambas|esos|esas|estos|estas|aquellas|aquellos)\s+(unidades|moviles|vehiculos|camiones)\b/.test(
      norm,
    ) ||
    /\b(esas|estos|aquellas)\s+dos\b/.test(norm) ||
    /\bunidad(es)?\s+(y|con|versus|vs)\s+/.test(norm);

  // "Comparar AG 382 QD con AB 111 ZZ"
  if (compareVerb && idCount >= 2) return true;

  // "¿Cuál reporta mejor entre AG 382 QD y AB 111 ZZ?"
  if (
    idCount >= 2 &&
    /\bentre\b/.test(norm) &&
    /\b(cual|que|mejor|peor|mas|menos|mayor|menor|report)/.test(norm)
  ) {
    return true;
  }

  // "Diferencia de reporte entre esas dos unidades"
  if (compareVerb && (multiUnitCue || (/\bentre\b/.test(norm) && /\bunidad/.test(norm)))) {
    return true;
  }

  // Dos+ ids + verbo/marco comparativo explícito
  if (idCount >= 2 && compareVerb && betweenCue) return true;

  return false;
}

/**
 * Pregunta selectiva + comparativa sobre la flota (estructural, sin frases literales fijas).
 */
function isCrossFleetComparativeQuestion(norm: string): boolean {
  if (isFleetListRequest(norm)) return false;

  const selective =
    /\b(cual|cuales|que)\s+(\w+\s+){0,6}unidad/.test(norm) ||
    /\b(la|el)\s+que\b.{0,24}\b(mas|menos|mayor|menor|peor|mejor|ultim\w*|prim\w*)/.test(norm) ||
    /\bque\s+unidad\s+(mas|menos|mayor|menor|peor|mejor|ultim\w*|prim\w*)/.test(norm);

  const comparative =
    /\b(mas|menos|mayor|menor|peor|mejor|ultim\w*|prim\w*|maxim\w*|minim\w*)\b/.test(norm) ||
    /\b(comparar|comparacion|ranking|ordenad\w*\s+por)\b/.test(norm);

  const fleetScope =
    /\b(unidad\w*|flota|camiones|vehiculos)\b/.test(norm) ||
    (/\b(la|el)\s+que\b/.test(norm) && /\b(sin report|report\w*|offline)\b/.test(norm));

  return selective && comparative && fleetScope;
}

function isAggregateComparisonRequest(raw: string, norm: string): boolean {
  return isMultiUnitComparisonRequest(raw, norm) || isCrossFleetComparativeQuestion(norm);
}

/** Consulta GPS/reporte de una unidad sin identificador concreto (no ranking). */
function looksLikeIndividualUnitConsultWithoutId(raw: string, norm: string): boolean {
  if (isAggregateComparisonRequest(raw, norm)) return false;
  const unitCue = /\bunidad\w*\b/.test(norm);
  const consultCue =
    /\b(reporte|gps|ignicion|offline|sin reporte|no reporta|estado|ubicacion|posicion)\b/.test(
      norm,
    );
  if (unitCue && consultCue) return true;
  if (consultCue && /\b(de la|del|de)\s+[a-záéíóú]{3,}/i.test(raw)) return true;
  return false;
}

export function classifyFleetQueryKind(
  text: string | null | undefined,
): FleetQueryClassification {
  const raw = String(text ?? "").trim();
  const empty: FleetQueryClassification = {
    kind: "none",
    scope: "other",
    hasUnitIdentifier: false,
    isComparativeQuestion: false,
  };
  if (!raw || raw.length > 220) return empty;

  const norm = normFleetQueryText(raw);

  if (isFleetListRequest(norm)) {
    return {
      kind: "fleet_list",
      scope: "fleet_catalog",
      hasUnitIdentifier: false,
      isComparativeQuestion: false,
    };
  }

  const hasUnitIdentifier = hasConcreteUnitIdentifier(raw, norm);

  // Comparación de 2+ unidades (o ranking de flota) ANTES del shortcut por patente.
  if (isAggregateComparisonRequest(raw, norm)) {
    return {
      kind: "aggregate_comparison",
      scope: "cross_fleet_metric",
      hasUnitIdentifier,
      isComparativeQuestion: true,
    };
  }

  if (hasUnitIdentifier) {
    return {
      kind: "individual_unit",
      scope: "single_unit",
      hasUnitIdentifier: true,
      isComparativeQuestion: false,
    };
  }

  if (looksLikeIndividualUnitConsultWithoutId(raw, norm)) {
    return {
      kind: "individual_unit",
      scope: "single_unit",
      hasUnitIdentifier: false,
      isComparativeQuestion: false,
    };
  }

  return empty;
}

export function buildAggregateFleetComparisonLimitReply(): string {
  return [
    "No puedo comparar toda la flota ni decirte cuál unidad «gana» en un ranking general — solo consulto **unidad por unidad** en Wara.",
    "",
    "Pasame la patente, el código interno o la marca de **una unidad concreta**, o escribí **listado de mis unidades** si querés ver opciones de tu flota.",
  ].join("\n");
}

/**
 * Bloquea aclaraciones IA que prometen resolver un ranking pidiendo una patente.
 */
export function clarificationPromisesAggregateRankingViaPlate(
  clarifyQuestion: string | null | undefined,
): boolean {
  const q = normFleetQueryText(String(clarifyQuestion ?? ""));
  if (!q) return false;

  const asksIdentifier =
    /\b(patente|matricula|marca|nombre|codigo|interno|chapa)\b/.test(q) ||
    /\bcual\s+me\s+pas/.test(q);

  const rankingFrame =
    /\b(cual|que)\s+(\w+\s+){0,4}unidad/.test(q) ||
    /\b(identificar|averiguar|saber|decirte|decir|encontrar)\b/.test(q) ||
    /\b(mas|menos|mayor|menor|peor|mejor|ranking|comparar|tiempo\s+sin\s+report|sin\s+report)\b/.test(
      q,
    );

  return asksIdentifier && rankingFrame;
}
