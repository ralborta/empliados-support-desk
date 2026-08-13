/**
 * Resolver estructurado de entidades.
 * NO lee el mensaje original — solo TurnPlan references + estado + flota.
 */
import {
  normalizeLoosePlate,
  isPlausibleVehiclePlate,
} from "../../pilot/plates.js";
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
    // fallback: page index into fleet
    const fu = state.fleetCache[n - 1];
    if (fu) return { status: "exact", unit: fleetToUnitRef(fu) };
    return { status: "not_found", query: String(n) };
  }

  const raw = ref.value.trim();
  if (!raw) return { status: "none" };

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

  const nameQ = raw.toLowerCase().replace(/\s+/g, "");
  const byNameExact = state.fleetCache.filter((u) => {
    const n = (u.name ?? "").toLowerCase().replace(/\s+/g, "");
    return n && n === nameQ;
  });
  if (byNameExact.length === 1) return { status: "exact", unit: fleetToUnitRef(byNameExact[0]!) };
  if (byNameExact.length > 1) {
    return {
      status: "many",
      candidates: byNameExact.map(fleetToUnitRef),
      labels: byNameExact.map((u) => u.label),
    };
  }

  // código interno tipo M900-072 / 900-072
  const code = raw.toUpperCase().replace(/\s+/g, "");
  const byCode = state.fleetCache.filter((u) => {
    const n = (u.name ?? "").toUpperCase().replace(/\s+/g, "");
    return n === code || n === `M${code}` || n.endsWith(code);
  });
  if (byCode.length === 1) return { status: "exact", unit: fleetToUnitRef(byCode[0]!) };
  if (byCode.length > 1) {
    return {
      status: "many",
      candidates: byCode.map(fleetToUnitRef),
      labels: byCode.map((u) => u.label),
    };
  }

  // parciales → many, nunca select silencioso
  const partial = state.fleetCache.filter((u) => {
    const p = (u.plate ?? "").toUpperCase();
    const n = (u.name ?? "").toUpperCase();
    const q = raw.toUpperCase().replace(/\s+/g, "");
    return (p && p.includes(q)) || (n && n.includes(q));
  });
  if (partial.length === 1) {
    // partial única aún se muestra como many policy? Spec: exact unique may select; partial never silent.
    // Una sola parcial → treat as many with one option (ask confirm) OR exact if strong.
    // Spec: "coincidencias parciales nunca se seleccionan silenciosamente"
    return {
      status: "many",
      candidates: partial.map(fleetToUnitRef),
      labels: partial.map((u) => u.label),
    };
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
