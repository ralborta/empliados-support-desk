/**
 * Filtrado, paginación y búsqueda de flota (portado de V1 route.ts + waraUnitIntent.ts).
 */
import type { WaraUnidadEstado } from "./wara-types.js";
import {
  detectLoosePlate,
  formatPlateWithSpaces,
  isPlausibleVehiclePlate,
  normalizeLoosePlate,
  normalizePlate,
} from "./plates.js";

export const FLEET_PAGE_SIZE = 8;
export const SESSION_TTL_MS = 45 * 60 * 1000;

export type FleetUnitRef = {
  movil_id: number;
  patente: string;
  unidad: string;
  label: string;
};

export type PaginatedFleetListing = {
  kind: "fleet_page" | "search_results" | "plates_only";
  page: number;
  pageSize: number;
  totalCount: number;
  indexMap: Record<string, FleetUnitRef>;
  units: WaraUnidadEstado[];
  shownAt: string;
  searchLabel?: string;
};

function unitSortKey(u: WaraUnidadEstado): string {
  const plate = normalizeLoosePlate(u.patente || "");
  const name = (u.unidad || "").trim().toUpperCase();
  return `${plate || "ZZZ"}|${name}|${u.movil_id}`;
}

/** Solo unidades válidas de WARA: patente o nombre real, sin duplicados por movil_id. */
export function filterValidFleetUnits(units: WaraUnidadEstado[]): WaraUnidadEstado[] {
  const seen = new Set<number>();
  const out: WaraUnidadEstado[] = [];
  for (const u of units) {
    if (!u || typeof u.movil_id !== "number" || !Number.isFinite(u.movil_id)) continue;
    if (seen.has(u.movil_id)) continue;
    const patente = (u.patente || "").trim();
    const unidad = (u.unidad || "").trim();
    if (!patente && !unidad) continue;
    seen.add(u.movil_id);
    out.push(u);
  }
  return out.sort((a, b) => unitSortKey(a).localeCompare(unitSortKey(b)));
}

export function formatUnitLabel(unit: WaraUnidadEstado): string {
  const plateRaw = unit.patente?.trim() || "";
  const plate = plateRaw ? formatPlateWithSpaces(normalizeLoosePlate(plateRaw)) : "";
  const nombre = unit.unidad?.trim() || "";
  if (plate && nombre && normalizeLoosePlate(plate) !== normalizeLoosePlate(nombre)) {
    return `${plate} (${nombre})`;
  }
  return plate || nombre || "sin identificar";
}

export function toFleetUnitRef(unit: WaraUnidadEstado): FleetUnitRef {
  return {
    movil_id: unit.movil_id,
    patente: unit.patente?.trim() || "",
    unidad: unit.unidad?.trim() || "",
    label: formatUnitLabel(unit),
  };
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

function levenshtein(a: string, b: string): number {
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

function fuzzyMatchUnitByPlate(units: WaraUnidadEstado[], plate: string): WaraUnidadEstado | null {
  const wanted = normalizeLoosePlate(plate);
  if (!wanted || wanted.length < 4) return null;
  let best: WaraUnidadEstado | null = null;
  let bestDist = 99;
  for (const u of units) {
    const p = normalizeLoosePlate(u.patente || "");
    if (!p) continue;
    const d = levenshtein(wanted, p);
    if (d <= 1 && d < bestDist) {
      bestDist = d;
      best = u;
    }
  }
  return best;
}

export function filterUnitsByResolvedPlate(
  units: WaraUnidadEstado[],
  plate: string,
): WaraUnidadEstado[] {
  const exact = filterUnitsByPlate(units, plate);
  if (exact.length > 0) return exact;
  const fuzzy = fuzzyMatchUnitByPlate(units, plate);
  return fuzzy ? [fuzzy] : [];
}

function normalizeToken(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function haystackWords(unit: WaraUnidadEstado): string[] {
  const raw = `${unit.patente || ""} ${unit.unidad || ""}`;
  return normalizeToken(raw)
    .split(/\s+/)
    .filter((w) => w.length >= 2);
}

function termMatchesWord(term: string, word: string): boolean {
  if (term === word) return true;
  if (term.length >= 4 && word.startsWith(term)) return true;
  if (word.length >= 4 && term.startsWith(word)) return true;
  if (term.length >= 6 && word.length >= 6 && levenshtein(term, word) <= 1) return true;
  return false;
}

export function filterUnitsBySearchTerms(
  units: WaraUnidadEstado[],
  terms: string[],
): WaraUnidadEstado[] {
  const normTerms = terms.map(normalizeToken).filter((t) => t.length >= 2);
  if (!normTerms.length) return [];
  const unitsWithWords = units.map((unit) => ({ unit, words: haystackWords(unit) }));
  const knownTerms = normTerms.filter((term) =>
    unitsWithWords.some(({ words }) => words.some((w) => termMatchesWord(term, w))),
  );
  if (!knownTerms.length) return [];
  return unitsWithWords
    .filter(({ words }) =>
      knownTerms.every((term) => words.some((w) => termMatchesWord(term, w))),
    )
    .map(({ unit }) => unit);
}

function normalizeUnitNameToken(value: string): string {
  return value.replace(/[\u2010-\u2015\u2212]/g, "-").replace(/[\s-]+/g, "").toLowerCase();
}

export function extractUnitNameCode(text: string): string | null {
  const m = text.match(/\b(M?\d{3}-\d{2,3})\b/i);
  return m?.[1] ? normalizeUnitNameToken(m[1]) : null;
}

export function filterUnitsByUnitName(
  units: WaraUnidadEstado[],
  code: string,
): WaraUnidadEstado[] {
  const wanted = normalizeUnitNameToken(code);
  if (!wanted) return [];
  return units.filter((u) => {
    const field = String(u.unidad ?? "");
    const codes = new Set<string>();
    codes.add(normalizeUnitNameToken(field));
    for (const match of field.matchAll(/\b(M?\d{3}-\d{2,3})\b/gi)) {
      codes.add(normalizeUnitNameToken(match[1]!));
    }
    if (codes.has(wanted)) return true;
    if (!/^m\d/.test(wanted) && [...codes].some((c) => c === `m${wanted}`)) return true;
    return false;
  });
}

export function buildPaginatedListing(input: {
  units: WaraUnidadEstado[];
  page: number;
  kind?: PaginatedFleetListing["kind"];
  searchLabel?: string;
}): PaginatedFleetListing {
  const filtered = filterValidFleetUnits(input.units);
  const pageSize = FLEET_PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(Math.max(1, input.page), totalPages);
  const indexMap: Record<string, FleetUnitRef> = {};
  for (let i = 0; i < filtered.length; i++) {
    indexMap[String(i + 1)] = toFleetUnitRef(filtered[i]!);
  }
  return {
    kind: input.kind ?? "fleet_page",
    page,
    pageSize,
    totalCount: filtered.length,
    indexMap,
    units: filtered,
    shownAt: new Date().toISOString(),
    searchLabel: input.searchLabel,
  };
}

export function sliceListingPage(listing: PaginatedFleetListing): WaraUnidadEstado[] {
  const start = (listing.page - 1) * listing.pageSize;
  return listing.units.slice(start, start + listing.pageSize);
}

export function formatPaginatedFleetMessage(
  listing: PaginatedFleetListing,
  companyName: string | null,
): string {
  const pageUnits = sliceListingPage(listing);
  const startIdx = (listing.page - 1) * listing.pageSize;
  const lines = pageUnits.map((u, i) => `${startIdx + i + 1}. ${formatUnitLabel(u)}`);
  const totalPages = Math.max(1, Math.ceil(listing.totalCount / listing.pageSize));
  const company = companyName || "tu empresa";
  const header =
    listing.kind === "plates_only"
      ? `Patentes de unidades en ${company} (solo datos WARA):`
      : listing.kind === "search_results" && listing.searchLabel
        ? `Encontré ${listing.totalCount} unidades para «${listing.searchLabel}» en ${company}:`
        : `Unidades en ${company} (página ${listing.page}/${totalPages}, ${listing.totalCount} en total):`;
  const nav =
    totalPages > 1
      ? `\n\nDecime el número (ej. «22» o «la 22»), «siguiente»/«anterior» para otra página, o la patente/nombre para buscar.`
      : `\n\nDecime el número o la patente/nombre de la unidad que querés consultar.`;
  return `${header}\n\n${lines.join("\n")}${nav}`;
}

export function formatPlatesOnlyMessage(
  listing: PaginatedFleetListing,
  companyName: string | null,
): string {
  const plates = listing.units
    .map((u) => u.patente?.trim())
    .filter((p): p is string => !!p && isPlausibleVehiclePlate(p))
    .map((p) => formatPlateWithSpaces(normalizeLoosePlate(p)));
  const unique = [...new Set(plates)];
  if (!unique.length) {
    return `No encontré patentes válidas en WARA para ${companyName || "tu empresa"}.`;
  }
  const head = unique.slice(0, FLEET_PAGE_SIZE).join(", ");
  const extra = unique.length > FLEET_PAGE_SIZE ? ` y ${unique.length - FLEET_PAGE_SIZE} más` : "";
  return (
    `Estas son patentes reales de ${companyName || "tu empresa"} según WARA (${unique.length} en total): ${head}${extra}. ` +
    `Decime una patente o pedime el reporte de una en particular.`
  );
}

export function resolveUnitFromListing(
  listing: PaginatedFleetListing,
  index: number,
): FleetUnitRef | null {
  return listing.indexMap[String(index)] ?? null;
}

export function resolveUnitByPlateFromFleet(
  fleet: WaraUnidadEstado[],
  text: string,
): { kind: "one"; unit: WaraUnidadEstado } | { kind: "many"; units: WaraUnidadEstado[] } | { kind: "none" } {
  const plate = detectLoosePlate(text);
  if (!plate) return { kind: "none" };
  const matches = filterUnitsByResolvedPlate(filterValidFleetUnits(fleet), plate);
  if (matches.length === 1) return { kind: "one", unit: matches[0]! };
  if (matches.length > 1) return { kind: "many", units: matches };
  return { kind: "none" };
}

export function resolveUnitByNameFromFleet(
  fleet: WaraUnidadEstado[],
  text: string,
): { kind: "one"; unit: WaraUnidadEstado } | { kind: "many"; units: WaraUnidadEstado[] } | { kind: "none" } {
  const valid = filterValidFleetUnits(fleet);
  const code = extractUnitNameCode(text);
  if (code) {
    const byCode = filterUnitsByUnitName(valid, code);
    if (byCode.length === 1) return { kind: "one", unit: byCode[0]! };
    if (byCode.length > 1) return { kind: "many", units: byCode };
  }
  const plate = detectLoosePlate(text);
  if (plate) {
    const byPlate = filterUnitsByResolvedPlate(valid, plate);
    if (byPlate.length === 1) return { kind: "one", unit: byPlate[0]! };
    if (byPlate.length > 1) return { kind: "many", units: byPlate };
  }
  const terms = normalizeToken(text)
    .split(/\s+/)
    .filter((t) => t.length >= 3);
  if (!terms.length) return { kind: "none" };
  const matches = filterUnitsBySearchTerms(valid, terms);
  if (matches.length === 1) return { kind: "one", unit: matches[0]! };
  if (matches.length > 1) return { kind: "many", units: matches };
  return { kind: "none" };
}

export function extractSearchToken(text: string): string | null {
  const plate = detectLoosePlate(text);
  if (plate) return plate;
  const code = extractUnitNameCode(text);
  if (code) return code;
  const cleaned = text
    .replace(/\b(reporte|informe|estado|gps|de|la|el|unidad|unidades|quiero|dame|pasame|decime)\b/gi, " ")
    .trim();
  if (cleaned.length >= 2 && cleaned.length <= 40) return cleaned;
  return null;
}

export function isListingFresh(listing: PaginatedFleetListing | null | undefined): boolean {
  if (!listing?.shownAt) return false;
  const age = Date.now() - new Date(listing.shownAt).getTime();
  return age >= 0 && age < SESSION_TTL_MS;
}

export function findUnitInFleetByRef(
  fleet: WaraUnidadEstado[],
  ref: FleetUnitRef,
): WaraUnidadEstado | null {
  return fleet.find((u) => u.movil_id === ref.movil_id) ?? null;
}

export function plateFromRef(ref: FleetUnitRef): string {
  return normalizeLoosePlate(ref.patente || ref.unidad || "") || ref.patente;
}
