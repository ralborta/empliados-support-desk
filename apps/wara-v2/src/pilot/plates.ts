/** Normalización mínima de patentes (portado de V1 wara.ts). */

const PLATE_STOPWORDS = new Set(["DEL", "LOS", "LAS", "UNA", "UNO", "CON", "POR", "SUS"]);
const EXAMPLE_PLATES = new Set(["ABC123", "AAA123"]);

const PLATE_REGEX_GLOBAL =
  /\b([A-Za-z]{2,3}\s?\d{3,4}\s?[A-Za-z]{0,2}|\d{3,4}\s?[A-Za-z]{2,3})\b/g;

export function normalizePlate(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.toUpperCase().replace(/[\s\-_.]+/g, "");
}

export function normalizeLoosePlate(value: string): string {
  return normalizePlate(value)?.replace(/\s+/g, "") ?? "";
}

export function isPlausibleVehiclePlate(value: string | null | undefined): boolean {
  const compact = normalizePlate(value);
  if (!compact || compact.length < 5 || compact.length > 9) return false;
  if (!/\d/.test(compact)) return false;
  if (EXAMPLE_PLATES.has(compact)) return false;
  const letters = compact.match(/^[A-Z]+/)?.[0] ?? "";
  if (letters.length === 3 && PLATE_STOPWORDS.has(letters)) return false;
  return (
    /^[A-Z]{2}\d{3}[A-Z]{2}$/.test(compact) ||
    /^[A-Z]{3}\d{3}$/.test(compact) ||
    /^[A-Z]{3}\d{4}$/.test(compact)
  );
}

export function detectPlate(text: string): string | null {
  if (!text) return null;
  for (const match of text.matchAll(PLATE_REGEX_GLOBAL)) {
    const plate = normalizePlate(match[1]);
    if (!plate || EXAMPLE_PLATES.has(plate)) continue;
    const letters = plate.match(/^[A-Z]+/)?.[0] ?? "";
    if (letters.length === 3 && PLATE_STOPWORDS.has(letters)) continue;
    if (isPlausibleVehiclePlate(plate)) return plate;
  }
  return null;
}

export function detectLoosePlate(text: string): string | null {
  const stripped = text.trim().replace(/^(?:la|el)\s+/i, "");
  const fromRegex = detectPlate(stripped) ?? detectPlate(text);
  if (fromRegex) return fromRegex;
  const compact = normalizePlate(stripped);
  if (compact && isPlausibleVehiclePlate(compact)) return compact;
  return null;
}

export function formatPlateWithSpaces(plate: string): string {
  const p = normalizeLoosePlate(plate);
  if (p.length >= 6 && /^[A-Z]{2}\d{3}[A-Z]{2}$/.test(p)) {
    return `${p.slice(0, 2)} ${p.slice(2, 5)} ${p.slice(5)}`;
  }
  if (p.length >= 6 && /^[A-Z]{3}\d{3}$/.test(p)) {
    return `${p.slice(0, 3)} ${p.slice(3)}`;
  }
  return plate.trim().toUpperCase();
}

/**
 * Patente para APIs WARA: preferí la matrícula tal como viene en flota.
 * (V1 `resolveWaraPatenteForApi` — reformatear a ciegas provoca "No se encontró el vehículo".)
 */
export function resolveWaraPatenteForApi(
  clientInput: string,
  fleetUnit?: { patente?: string | null; unidad?: string | null } | null,
): string {
  const fromFleet = fleetUnit?.patente?.trim();
  if (fromFleet) return fromFleet;

  const wanted = normalizeLoosePlate(clientInput);
  const unitName = fleetUnit?.unidad?.trim();
  if (unitName && wanted) {
    const unitNorm = normalizeLoosePlate(unitName);
    if (
      unitNorm &&
      (unitNorm === wanted ||
        unitNorm.includes(wanted) ||
        wanted.includes(unitNorm))
    ) {
      return unitName;
    }
  }

  const client = clientInput.trim();
  if (client) return client;
  return normalizeLoosePlate(clientInput) || clientInput;
}

/** Candidatos a probar ante "unidad no encontrada" (flota → espacios → compacta). */
export function plateCandidatesForWaraApi(
  clientInput: string,
  fleetPatente?: string | null,
): string[] {
  const out: string[] = [];
  const add = (p?: string | null) => {
    const t = (p ?? "").trim();
    if (t && !out.some((x) => normalizeLoosePlate(x) === normalizeLoosePlate(t) && x === t)) {
      // Prefer exact string match uniqueness (AH881VD ≠ "AH 881 VD")
      if (!out.includes(t)) out.push(t);
    }
  };
  add(fleetPatente);
  add(resolveWaraPatenteForApi(clientInput, { patente: fleetPatente }));
  add(formatPlateWithSpaces(normalizeLoosePlate(clientInput || fleetPatente || "")));
  add(normalizeLoosePlate(clientInput || fleetPatente || ""));
  return out.filter(Boolean);
}
