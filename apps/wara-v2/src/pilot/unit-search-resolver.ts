/**
 * Resolución determinística de búsqueda de unidades sobre flota WARA real.
 */
import {
  filterUnitsByPlatePrefix,
  filterUnitsByPlateSuffix,
  filterUnitsByPlateContains,
} from "./plate-prefix.js";
import {
  filterValidFleetUnits,
  filterUnitsByResolvedPlate,
  filterUnitsByUnitName,
  filterUnitsBySearchTerms,
  isListingFresh,
  resolveUnitFromListing,
  sliceListingPage,
  type FleetUnitRef,
  type PaginatedFleetListing,
} from "./unit-fleet.js";
import type { WaraUnidadEstado } from "./wara-types.js";
import type { UnitSearchInterpretation } from "./unit-search-semantics.js";

export type UnitSearchResult =
  | { kind: "none"; label: string }
  | { kind: "one"; unit: WaraUnidadEstado; label: string }
  | { kind: "many"; units: WaraUnidadEstado[]; label: string };

export type UnitSearchContext = {
  lastListing?: PaginatedFleetListing | null;
  selectedUnit?: FleetUnitRef | null;
  lastSelectedIndex?: number | null;
};

function searchScopeUnits(
  fleet: WaraUnidadEstado[],
  ctx: UnitSearchContext,
  preferListing: boolean,
): WaraUnidadEstado[] {
  const valid = filterValidFleetUnits(fleet);
  if (
    preferListing &&
    ctx.lastListing &&
    isListingFresh(ctx.lastListing) &&
    ctx.lastListing.units.length > 0
  ) {
    const listingIds = new Set(ctx.lastListing.units.map((u) => u.movil_id));
    const inListing = valid.filter((u) => listingIds.has(u.movil_id));
    if (inListing.length > 0) return inListing;
  }
  return valid;
}

function applyMatchMode(
  units: WaraUnidadEstado[],
  interpretation: UnitSearchInterpretation,
): WaraUnidadEstado[] {
  const q = interpretation.query.replace(/[\s\-_.]+/g, "").toUpperCase();
  switch (interpretation.matchMode) {
    case "exact":
      if (interpretation.entity === "unit_name") {
        const byCode = filterUnitsByUnitName(units, interpretation.query);
        if (byCode.length > 0) return byCode;
        const terms = interpretation.query
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase()
          .split(/\s+/)
          .filter((t) => t.length >= 3);
        if (terms.length > 0) return filterUnitsBySearchTerms(units, terms);
        return [];
      }
      return filterUnitsByResolvedPlate(units, interpretation.query);
    case "prefix":
      return filterUnitsByPlatePrefix(units, q);
    case "suffix":
      return filterUnitsByPlateSuffix(units, q);
    case "contains":
      return filterUnitsByPlateContains(units, q);
    case "index":
    case "contextual":
      return [];
    default:
      return [];
  }
}

function resolveContextualUnit(
  interpretation: UnitSearchInterpretation,
  ctx: UnitSearchContext,
  fleet: WaraUnidadEstado[],
): WaraUnidadEstado | null {
  const kind = interpretation.contextualKind;
  if (!kind) return null;

  if (kind === "selected" && ctx.selectedUnit) {
    return fleet.find((u) => u.movil_id === ctx.selectedUnit!.movil_id) ?? null;
  }

  if (!ctx.lastListing || !isListingFresh(ctx.lastListing)) {
    if (kind === "selected" && ctx.selectedUnit) {
      return fleet.find((u) => u.movil_id === ctx.selectedUnit!.movil_id) ?? null;
    }
    return null;
  }

  const pageUnits = sliceListingPage(ctx.lastListing);
  const pageStart = (ctx.lastListing.page - 1) * ctx.lastListing.pageSize;

  if (kind === "first_on_page" && pageUnits[0]) return pageUnits[0]!;
  if (kind === "last_on_page" && pageUnits.length > 0) {
    return pageUnits[pageUnits.length - 1]!;
  }

  if (kind === "previous" && ctx.lastSelectedIndex != null && ctx.lastSelectedIndex > 1) {
    const ref = resolveUnitFromListing(ctx.lastListing, ctx.lastSelectedIndex - 1);
    if (ref) return fleet.find((u) => u.movil_id === ref.movil_id) ?? null;
  }

  if (kind === "next" && ctx.lastSelectedIndex != null) {
    const ref = resolveUnitFromListing(ctx.lastListing, ctx.lastSelectedIndex + 1);
    if (ref) return fleet.find((u) => u.movil_id === ref.movil_id) ?? null;
  }

  if (kind === "selected" && ctx.lastSelectedIndex != null) {
    const ref = resolveUnitFromListing(ctx.lastListing, ctx.lastSelectedIndex);
    if (ref) return fleet.find((u) => u.movil_id === ref.movil_id) ?? null;
  }

  void pageStart;
  return null;
}

export function executeUnitSearch(
  interpretation: UnitSearchInterpretation,
  fleet: WaraUnidadEstado[],
  ctx: UnitSearchContext = {},
): UnitSearchResult {
  const valid = filterValidFleetUnits(fleet);
  const label = interpretation.query;

  if (interpretation.matchMode === "index" && interpretation.index != null) {
    if (!ctx.lastListing || !isListingFresh(ctx.lastListing)) {
      return { kind: "none", label: String(interpretation.index) };
    }
    const ref = resolveUnitFromListing(ctx.lastListing, interpretation.index);
    if (!ref) return { kind: "none", label: String(interpretation.index) };
    const unit = valid.find((u) => u.movil_id === ref.movil_id);
    if (!unit) return { kind: "none", label: String(interpretation.index) };
    return { kind: "one", unit, label: ref.label };
  }

  if (interpretation.matchMode === "contextual") {
    const unit = resolveContextualUnit(interpretation, ctx, valid);
    if (!unit) return { kind: "none", label };
    return { kind: "one", unit, label: interpretation.query };
  }

  const preferListing =
    interpretation.matchMode === "prefix" ||
    interpretation.matchMode === "contains" ||
    interpretation.matchMode === "suffix";

  let scope = searchScopeUnits(valid, ctx, preferListing);
  let matches = applyMatchMode(scope, interpretation);

  if (matches.length === 0 && preferListing && scope.length < valid.length) {
    scope = valid;
    matches = applyMatchMode(scope, interpretation);
  }

  if (matches.length === 0) {
    return { kind: "none", label };
  }
  if (matches.length === 1) {
    return { kind: "one", unit: matches[0]!, label };
  }
  return { kind: "many", units: matches, label };
}

export function formatUnitSearchNotFound(
  interpretation: UnitSearchInterpretation,
  companyName: string | null,
): string {
  const company = companyName || "tu empresa";
  const q = interpretation.query;
  switch (interpretation.matchMode) {
    case "prefix":
      return `No encontré unidades que empiecen con «${q}» en WARA para ${company}. Probá con más letras de la patente o pedime la lista.`;
    case "suffix":
      return `No encontré unidades que terminen en «${q}» en WARA para ${company}. Decime más de la patente o pedime la lista.`;
    case "contains":
      return `No encontré unidades que contengan «${q}» en WARA para ${company}. Decime más de la patente o pedime la lista.`;
    default:
      return `No encontré «${q}» en WARA para ${company}. Decime la patente, el número/código o el nombre, o pedime la lista.`;
  }
}

export function formatUnitSearchManyHeader(
  interpretation: UnitSearchInterpretation,
  count: number,
  companyName: string | null,
): string {
  const company = companyName || "tu empresa";
  const q = interpretation.query;
  if (interpretation.intent === "unit_status") {
    return `Encontré ${count} unidades para el estado GPS con «${q}» en ${company}:`;
  }
  return `Encontré ${count} unidades para «${q}» en ${company}:`;
}
