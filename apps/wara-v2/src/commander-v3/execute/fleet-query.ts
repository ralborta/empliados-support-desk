/**
 * Helpers de flota para unit.search (query estructurada del TurnPlan).
 */
import {
  extractUnitNameCode,
  filterUnitsBySearchTerms,
  filterUnitsByUnitName,
} from "../../pilot/unit-fleet.js";
import {
  isPlausibleVehiclePlate,
  normalizeLoosePlate,
} from "../../pilot/plates.js";
import type { ConversationStateV3 } from "../types/state.js";

/** Query válida de filtro (patente/código/marca corta). Frases conversacionales no son query. */
export function isStructuredFleetQuery(query: string): boolean {
  const q = query.trim();
  if (!q || q.length > 40) return false;
  if (/[?]/.test(q)) return false;
  if (extractUnitNameCode(q)) return true;
  const plate = normalizeLoosePlate(q);
  if (plate && isPlausibleVehiclePlate(plate)) return true;
  const words = q.split(/\s+/).filter(Boolean);
  // Filtro de flota = token corto (marca/prefijo), no oración.
  return words.length <= 2 && q.length <= 24;
}

export function filterFleetCacheByQuery(
  state: ConversationStateV3,
  query: string,
): ConversationStateV3["fleetCache"] {
  const q = query.trim();
  if (!q) return state.fleetCache;

  const fleetLike = state.fleetCache.map((u) => ({
    movil_id: u.movilId,
    unidad: u.name ?? "",
    patente: u.plate ?? "",
  }));

  const plate = normalizeLoosePlate(q);
  if (plate && isPlausibleVehiclePlate(plate)) {
    const hits = state.fleetCache.filter(
      (u) => u.plate && normalizeLoosePlate(u.plate) === plate,
    );
    if (hits.length) return hits;
  }

  const code = extractUnitNameCode(q);
  if (code) {
    const byCode = filterUnitsByUnitName(fleetLike as never, code);
    if (byCode.length) {
      const ids = new Set(byCode.map((u) => u.movil_id));
      return state.fleetCache.filter((u) => ids.has(u.movilId));
    }
  }

  const terms = q
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
  if (terms.length) {
    const byTerms = filterUnitsBySearchTerms(fleetLike as never, terms);
    if (byTerms.length) {
      const ids = new Set(byTerms.map((u) => u.movil_id));
      return state.fleetCache.filter((u) => ids.has(u.movilId));
    }
  }

  const soft = q.toLowerCase();
  return state.fleetCache.filter((u) => {
    const label = u.label.toLowerCase();
    const name = (u.name ?? "").toLowerCase();
    const p = (u.plate ?? "").toLowerCase();
    return label.includes(soft) || name.includes(soft) || p.includes(soft);
  });
}
