/**
 * Extracción numérica neutral y resolución contextual de rol (unidad vs valor de medidor).
 * Sin dependencias de wara.ts / waraUnitIntent.ts para evitar ciclos.
 */

export type EmbeddedNumericReference = {
  raw: string;
  value: number;
  span: { start: number; end: number };
  source: "explicit_interno" | "embedded" | "bare";
};

export type NumericExpectedField = "unit" | "meter_value" | "none";

export type ServiceIntentKind =
  | "estado_gps"
  | "certificado"
  | "mantenimiento"
  | "odometro"
  | "horometro"
  | "none";

export type FleetUnitRef = {
  movil_id?: unknown;
  unidad?: string | null;
  patente?: string | null;
};

export type NumericRoleResolution = {
  kind: "unit" | "meter_value" | "dual" | "ambiguous" | "none";
  unitMovilId?: number;
  meterValue?: number;
  clarification?: string;
};

const EXPLICIT_INTERNO =
  /\b(?:unida[d]?|interno|nro\.?\s+de\s+interno|n[uú]mero\s+de\s+interno)\s*(?:n[°o.]?\s*)?(\d{5,7})\b/gi;

const EMBEDDED_INTERN = /\b(\d{5,7})\b/g;

const DATE_NUMERIC =
  /\b\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}\b|\b\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2}\b/g;

function overlapsDateSpan(text: string, start: number, end: number): boolean {
  for (const m of text.matchAll(DATE_NUMERIC)) {
    const ds = m.index ?? -1;
    const de = ds + m[0].length;
    if (ds >= 0 && start < de && end > ds) return true;
  }
  return false;
}

function pushUnique(out: EmbeddedNumericReference[], ref: EmbeddedNumericReference): void {
  if (out.some((r) => r.value === ref.value && r.span.start === ref.span.start)) return;
  out.push(ref);
}

/** Extrae candidatos numéricos del texto sin asignar rol. */
export function extractEmbeddedNumericReferences(text: string): EmbeddedNumericReference[] {
  const raw = String(text ?? "");
  if (!raw.trim()) return [];

  const out: EmbeddedNumericReference[] = [];

  for (const m of raw.matchAll(EXPLICIT_INTERNO)) {
    const start = m.index ?? 0;
    const digits = m[1];
    pushUnique(out, {
      raw: digits,
      value: parseInt(digits, 10),
      span: { start, end: start + m[0].length },
      source: "explicit_interno",
    });
  }

  const compact = raw.trim().replace(/\s+/g, "");
  if (/^\d{5,7}$/.test(compact)) {
    pushUnique(out, {
      raw: compact,
      value: parseInt(compact, 10),
      span: { start: 0, end: raw.length },
      source: "bare",
    });
    return out;
  }

  for (const m of raw.matchAll(EMBEDDED_INTERN)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    if (overlapsDateSpan(raw, start, end)) continue;
    pushUnique(out, {
      raw: m[1],
      value: parseInt(m[1], 10),
      span: { start, end },
      source: "embedded",
    });
  }

  return out.filter((r) => Number.isFinite(r.value));
}

export function detectServiceIntentInMessage(text: string): ServiceIntentKind {
  const t = String(text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
  if (/\b(?:certificado|cobertura)\b/.test(t)) return "certificado";
  if (/\b(?:mantenimiento|preventiv\w*|correctiv\w*)\b/.test(t)) return "mantenimiento";
  if (/\bhor[oó]metro\b/.test(t)) return "horometro";
  if (/\b(?:od[oó]metro|kilometraje)\b/.test(t)) return "odometro";
  if (
    /\b(?:estado|gps|reporte|ignici[oó]n|posici[oó]n|ubicaci[oó]n|ultimo\s+reporte)\b/.test(t)
  ) {
    return "estado_gps";
  }
  return "none";
}

/**
 * "Certificado 900133" / "GPS 900079" / "Mantenimiento M900-112" / "Horometro 900133":
 * nombre de servicio + referencia de unidad, sin verbo.
 * Bug 2026-08-23: solo odómetro/horómetro estaba cubierto; el resto podía silenciarse.
 */
export function looksLikeNamedServiceWithUnitReference(
  text: string | undefined | null,
): boolean {
  const raw = String(text ?? "").trim();
  if (!raw || raw.length > 200) return false;
  if (detectServiceIntentInMessage(raw) === "none") return false;
  if (extractEmbeddedNumericReferences(raw).length > 0) return true;
  if (/\bM?\d{3}-\d{2,3}\b/i.test(raw)) return true;
  return false;
}

export function fleetHasMovilId(fleet: FleetUnitRef[] | undefined, movilId: number): boolean {
  if (!fleet?.length) return false;
  return fleet.some((u) => Number(u.movil_id) === movilId);
}

function isUnitServiceIntent(intent: ServiceIntentKind): boolean {
  return intent === "estado_gps" || intent === "certificado" || intent === "mantenimiento";
}

function isMeterServiceIntent(intent: ServiceIntentKind): boolean {
  return intent === "odometro" || intent === "horometro";
}

function pickFleetInterno(
  candidates: EmbeddedNumericReference[],
  fleet: FleetUnitRef[] | undefined,
): number | null {
  for (const c of candidates) {
    if (fleet?.length) {
      if (fleetHasMovilId(fleet, c.value)) return c.value;
    } else {
      return c.value;
    }
  }
  return null;
}

/** Asigna rol a candidatos según servicio, campo esperado y flota. */
export function resolveNumericRole(params: {
  rawText: string;
  candidates: EmbeddedNumericReference[];
  serviceIntent: ServiceIntentKind;
  expectedField: NumericExpectedField;
  fleet?: FleetUnitRef[];
  hasSelectedUnit?: boolean;
}): NumericRoleResolution {
  const text = String(params.rawText ?? "").trim();
  const candidates = params.candidates;
  if (!text || candidates.length === 0) return { kind: "none" };

  if (params.expectedField === "meter_value") {
    const value = candidates[candidates.length - 1]?.value;
    if (value != null) return { kind: "meter_value", meterValue: value };
    return { kind: "none" };
  }

  const explicit = candidates.filter((c) => c.source === "explicit_interno" || c.source === "bare");
  if (explicit.length === 1) {
    return { kind: "unit", unitMovilId: explicit[0].value };
  }
  if (explicit.length > 1) {
    return {
      kind: "ambiguous",
      clarification: "¿Cuál interno querés usar?",
    };
  }

  if (params.expectedField === "unit") {
    const movilId = pickFleetInterno(candidates, params.fleet);
    if (movilId != null) return { kind: "unit", unitMovilId: movilId };
    if (candidates.length === 1) {
      return { kind: "unit", unitMovilId: candidates[0].value };
    }
    return {
      kind: "ambiguous",
      clarification: "¿Cuál es la patente o el interno de la unidad?",
    };
  }

  if (isUnitServiceIntent(params.serviceIntent)) {
    const movilId = candidates[0]?.value;
    if (movilId != null) return { kind: "unit", unitMovilId: movilId };
  }

  if (isMeterServiceIntent(params.serviceIntent)) {
    if (candidates.length >= 2) {
      const unitCandidate =
        candidates.find((c) => fleetHasMovilId(params.fleet, c.value)) ?? candidates[0];
      const valueCandidate = candidates[candidates.length - 1];
      if (unitCandidate && valueCandidate && unitCandidate.value !== valueCandidate.value) {
        return {
          kind: "dual",
          unitMovilId: unitCandidate.value,
          meterValue: valueCandidate.value,
        };
      }
    }

    if (candidates.length === 1) {
      const only = candidates[0].value;
      if (params.fleet?.length) {
        if (fleetHasMovilId(params.fleet, only)) {
          return { kind: "unit", unitMovilId: only };
        }
        return {
          kind: "ambiguous",
          clarification:
            "No encontré ese interno en tu flota. ¿Es la patente/unidad o el valor del odómetro/horómetro?",
        };
      }
      return { kind: "unit", unitMovilId: only };
    }
  }

  return { kind: "none" };
}

/** API de alto nivel: extracción + rol en un paso. */
export function resolveUnitReferenceFromMessage(params: {
  rawText: string;
  serviceIntent?: ServiceIntentKind;
  expectedField?: NumericExpectedField;
  fleet?: FleetUnitRef[];
  hasSelectedUnit?: boolean;
}): NumericRoleResolution {
  const rawText = String(params.rawText ?? "").trim();
  const candidates = extractEmbeddedNumericReferences(rawText);
  const serviceIntent = params.serviceIntent ?? detectServiceIntentInMessage(rawText);
  const expectedField = params.expectedField ?? "none";

  return resolveNumericRole({
    rawText,
    candidates,
    serviceIntent,
    expectedField,
    fleet: params.fleet,
    hasSelectedUnit: params.hasSelectedUnit,
  });
}

/** Internos resueltos como unidad (compat con extractUnitCodeNumbersFromMessage). */
export function extractUnitMovilIdsFromMessage(params: {
  rawText: string;
  expectedField?: NumericExpectedField;
  fleet?: FleetUnitRef[];
}): number[] {
  const rawText = String(params.rawText ?? "");
  const expectedField = params.expectedField ?? "none";
  const resolution = resolveUnitReferenceFromMessage({
    rawText,
    expectedField,
    fleet: params.fleet,
  });

  const out: number[] = [];
  if (resolution.unitMovilId != null) out.push(resolution.unitMovilId);

  for (const m of rawText.matchAll(/\b(?:M|m)(\d{3})-(\d{2,3})\b/g)) {
    const n = parseInt(`${m[1]}${m[2]}`, 10);
    if (Number.isFinite(n) && !out.includes(n)) out.push(n);
  }

  if (expectedField === "meter_value") return out;

  for (const c of extractEmbeddedNumericReferences(rawText)) {
    if (c.source === "explicit_interno" || c.source === "bare") {
      if (!out.includes(c.value)) out.push(c.value);
    }
  }

  const intent = detectServiceIntentInMessage(rawText);
  if (isUnitServiceIntent(intent) || isMeterServiceIntent(intent)) {
    for (const c of extractEmbeddedNumericReferences(rawText)) {
      if (c.source !== "embedded" || out.includes(c.value)) continue;
      if (isUnitServiceIntent(intent)) {
        out.push(c.value);
      } else if (params.fleet?.length ? fleetHasMovilId(params.fleet, c.value) : true) {
        out.push(c.value);
      }
    }
  }

  return out;
}
