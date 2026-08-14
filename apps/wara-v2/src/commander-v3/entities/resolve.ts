/**
 * Resolver estructurado de entidades.
 * NO lee el mensaje original — solo TurnPlan references + estado + flota.
 */
import {
  normalizeLoosePlate,
  isPlausibleVehiclePlate,
} from "../../pilot/plates.js";
import {
  extractUnitNameCode,
  filterUnitsByUnitName,
} from "../../pilot/unit-fleet.js";
import type { ConversationStateV3 } from "../types/state.js";
import type { EntityReference } from "../types/refs.js";
import type { CompanyRef, UnitRef } from "../types/refs.js";

export type UnitResolveResult =
  | { status: "none" }
  | { status: "exact"; unit: UnitRef }
  | { status: "many"; candidates: UnitRef[]; labels: string[] }
  | { status: "not_found"; query: string };

export type CompanyResolveResult =
  | { status: "none" }
  | { status: "exact"; company: CompanyRef }
  | { status: "many"; candidates: CompanyRef[] }
  | { status: "not_found"; query: string };

function fleetToUnitRef(
  u: ConversationStateV3["fleetCache"][number],
): UnitRef {
  return {
    movilId: u.movilId,
    plate: u.plate,
    name: u.name,
    label: u.label,
  };
}

function normUnitToken(value: string): string {
  return value
    .toUpperCase()
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/[\s-]+/g, "");
}

/** Patente/código/nombre en el plan — no “la misma” ni la unidad ya activa. */
export function isExplicitUnitReference(
  ref: EntityReference | null | undefined,
): boolean {
  if (!ref || ref.kind !== "unit") return false;
  if (ref.mode === "contextual") return false;
  if (ref.reference === "active" || ref.reference === "previous") return false;
  return Boolean(String(ref.value ?? "").trim());
}

export function resolveUnitReference(
  ref: EntityReference | null | undefined,
  state: ConversationStateV3,
): UnitResolveResult {
  if (!ref || ref.kind !== "unit") return { status: "none" };

  if (ref.mode === "contextual" || ref.reference === "active") {
    if (ref.reference === "previous" || /anterior|previous/i.test(ref.value)) {
      if (state.previousUnit) return { status: "exact", unit: state.previousUnit };
      return { status: "not_found", query: "previous" };
    }
    if (state.unit) return { status: "exact", unit: state.unit };
    return { status: "not_found", query: "active" };
  }

  if (ref.mode === "index") {
    const n = Number.parseInt(ref.value, 10);
    if (!Number.isFinite(n) || n < 1) return { status: "not_found", query: ref.value };
    const listing = state.lastListing;
    if (listing) {
      const item = listing.items.find((i) => i.index === n);
      if (item?.movilId != null) {
        const fu = state.fleetCache.find((f) => f.movilId === item.movilId);
        if (fu) return { status: "exact", unit: fleetToUnitRef(fu) };
      }
    }
    const fu = state.fleetCache[n - 1];
    if (fu) return { status: "exact", unit: fleetToUnitRef(fu) };
    return { status: "not_found", query: String(n) };
  }

  // movilId explícito (a veces el LLM manda mode=id + número interno)
  if (ref.mode === "id") {
    const id = Number.parseInt(ref.value, 10);
    if (Number.isFinite(id)) {
      const fu = state.fleetCache.find((f) => f.movilId === id);
      if (fu) return { status: "exact", unit: fleetToUnitRef(fu) };
    }
    // mode=id con patente/texto: cae al match por valor abajo
  }

  const raw = ref.value.trim();
  if (!raw) return { status: "none" };

  if (/^\d{1,8}$/.test(raw)) {
    const asMovil = Number.parseInt(raw, 10);
    const byMovil = state.fleetCache.find((f) => f.movilId === asMovil);
    if (byMovil) return { status: "exact", unit: fleetToUnitRef(byMovil) };
    if (state.lastListing) {
      const item = state.lastListing.items.find((i) => i.index === asMovil);
      if (item?.movilId != null) {
        const fu = state.fleetCache.find((f) => f.movilId === item.movilId);
        if (fu) return { status: "exact", unit: fleetToUnitRef(fu) };
      }
    }
  }

  const plateNorm = normalizeLoosePlate(raw);
  if (plateNorm && isPlausibleVehiclePlate(plateNorm)) {
    const exact = state.fleetCache.filter(
      (u) => u.plate && normalizeLoosePlate(u.plate) === plateNorm,
    );
    if (exact.length === 1) return { status: "exact", unit: fleetToUnitRef(exact[0]!) };
    if (exact.length > 1) {
      return {
        status: "many",
        candidates: exact.map(fleetToUnitRef),
        labels: exact.map((u) => u.label),
      };
    }
  }

  const nameQ = normUnitToken(raw);
  const byNameExact = state.fleetCache.filter((u) => {
    const n = normUnitToken(u.name ?? "");
    return n && (n === nameQ || n === `M${nameQ}` || `M${n}` === nameQ);
  });
  if (byNameExact.length === 1) return { status: "exact", unit: fleetToUnitRef(byNameExact[0]!) };
  if (byNameExact.length > 1) {
    return {
      status: "many",
      candidates: byNameExact.map(fleetToUnitRef),
      labels: byNameExact.map((u) => u.label),
    };
  }

  // código interno: M900-072 / 900072 / 300097 → M300-097
  const code = extractUnitNameCode(raw) ?? nameQ;
  if (code) {
    const fleetLike = state.fleetCache.map((u) => ({
      movil_id: u.movilId,
      unidad: u.name,
      patente: u.plate,
    }));
    const hits = filterUnitsByUnitName(fleetLike as never, code);
    if (hits.length === 1) {
      const fu = state.fleetCache.find((f) => f.movilId === hits[0]!.movil_id);
      if (fu) return { status: "exact", unit: fleetToUnitRef(fu) };
    }
    if (hits.length > 1) {
      const units = hits
        .map((h) => state.fleetCache.find((f) => f.movilId === h.movil_id))
        .filter(Boolean)
        .map((u) => fleetToUnitRef(u!));
      return {
        status: "many",
        candidates: units,
        labels: units.map((u) => u.label),
      };
    }
  }

  const partial = state.fleetCache.filter((u) => {
    const p = normUnitToken(u.plate ?? "");
    const n = normUnitToken(u.name ?? "");
    const l = normUnitToken(u.label ?? "");
    const q = nameQ;
    return (
      (p && p.includes(q)) ||
      (n && n.includes(q)) ||
      (l && l.includes(q))
    );
  });
  // Una sola coincidencia parcial (marca/prefijo) = exacta; varias = desambiguar.
  if (partial.length === 1) {
    return { status: "exact", unit: fleetToUnitRef(partial[0]!) };
  }
  if (partial.length > 1) {
    return {
      status: "many",
      candidates: partial.slice(0, 20).map(fleetToUnitRef),
      labels: partial.slice(0, 20).map((u) => u.label),
    };
  }

  return { status: "not_found", query: raw };
}

export function resolveCompanyReference(
  ref: EntityReference | null | undefined,
  state: ConversationStateV3,
): CompanyResolveResult {
  if (!ref || ref.kind !== "company") return { status: "none" };
  if (ref.mode === "contextual" || ref.reference === "active") {
    if (state.company) return { status: "exact", company: state.company };
    return { status: "not_found", query: "active" };
  }
  if (ref.mode === "index") {
    const n = Number.parseInt(ref.value, 10);
    if (!Number.isFinite(n) || n < 1) return { status: "not_found", query: ref.value };
    if (state.lastListing?.kind === "companies") {
      const item = state.lastListing.items.find((i) => i.index === n);
      if (item?.companyId) {
        const c = state.availableCompanies.find((x) => x.id === item.companyId);
        if (c) return { status: "exact", company: c };
      }
    }
    const c = state.availableCompanies[n - 1];
    if (c) return { status: "exact", company: c };
    return { status: "not_found", query: String(n) };
  }
  if (ref.mode === "id") {
    const c = state.availableCompanies.find((x) => x.id === ref.value);
    if (c) return { status: "exact", company: c };
    return { status: "not_found", query: ref.value };
  }
  const q = ref.value.trim().toLowerCase();
  if (!q) return { status: "none" };
  const exact = state.availableCompanies.filter(
    (c) => c.name.toLowerCase() === q || c.id === ref.value,
  );
  if (exact.length === 1) return { status: "exact", company: exact[0]! };
  if (exact.length > 1) return { status: "many", candidates: exact };
  const partial = state.availableCompanies.filter((c) =>
    c.name.toLowerCase().includes(q),
  );
  if (partial.length === 1) return { status: "many", candidates: partial };
  if (partial.length > 1) return { status: "many", candidates: partial };
  return { status: "not_found", query: ref.value };
}
