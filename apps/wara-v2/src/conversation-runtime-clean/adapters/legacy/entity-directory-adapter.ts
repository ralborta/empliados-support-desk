import type { EntityResolver } from "../../core/ports/ports.js";
import type { ResolutionRequest } from "../../core/types/decision.js";
import type { ResolutionResult } from "../../core/types/resolution.js";
import type { CompanyState, ConversationStateClean, ListingItem, UnitState } from "../../core/types/state.js";

export type CleanEntityDirectory = Readonly<{ companies: readonly CompanyState[]; units: readonly UnitState[] }>;
function canonical(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}
function canonicalUnitCode(value: string): string { return canonical(value).replace(/^M(?=\d)/, ""); }
function fact(code: string, text: string) { return { code, source: "resolver" as const, text, verified: true }; }
function ambiguous(requestId: string, items: readonly ListingItem[]): ResolutionResult {
  return { requestId, status: "ambiguous", candidates: items, facts: [fact("ENTITY_AMBIGUOUS", "La referencia coincide con más de una entidad.")] };
}
function notFound(requestId: string): ResolutionResult {
  return { requestId, status: "not_found", facts: [fact("ENTITY_NOT_FOUND", "No se encontró una entidad para la referencia declarada.")] };
}
function listingEntity(request: ResolutionRequest, state: ConversationStateClean): ListingItem | null {
  const index = request.reference.index;
  if (!index || !state.lastListing || state.lastListing.kind !== request.entityType) return null;
  return state.lastListing.items.find((item) => item.index === index) ?? null;
}
function resolveCompany(request: ResolutionRequest, state: ConversationStateClean, companies: readonly CompanyState[]): ResolutionResult {
  if (request.reference.source === "active") return state.company
    ? { requestId: request.id, status: "resolved", entity: { entityType: "company", company: state.company }, facts: [fact("COMPANY_RESOLVED", "Empresa activa resuelta.")] }
    : notFound(request.id);
  const listed = listingEntity(request, state);
  if (listed) {
    const company = companies.find((candidate) => candidate.id === listed.id);
    return company ? { requestId: request.id, status: "resolved", entity: { entityType: "company", company }, facts: [fact("COMPANY_RESOLVED", "Empresa del listado resuelta.")] } : notFound(request.id);
  }
  const query = canonical(request.reference.expression);
  if (!query) return { requestId: request.id, status: "invalid", errors: ["empty_company_reference"] };
  const exact = companies.filter((company) => canonical(company.id) === query || canonical(company.name) === query);
  if (exact.length === 1) return { requestId: request.id, status: "resolved", entity: { entityType: "company", company: exact[0]! }, facts: [fact("COMPANY_RESOLVED", "Empresa resuelta.")] };
  if (exact.length > 1) return ambiguous(request.id, exact.map((company, index) => ({ index: index + 1, entityType: "company", id: company.id, label: company.name })));
  const partial = companies.filter((company) => canonical(company.name).includes(query));
  if (partial.length) return ambiguous(request.id, partial.map((company, index) => ({ index: index + 1, entityType: "company", id: company.id, label: company.name })));
  return notFound(request.id);
}
function resolveUnit(request: ResolutionRequest, state: ConversationStateClean, units: readonly UnitState[]): ResolutionResult {
  if (request.reference.source === "active") return state.unit
    ? { requestId: request.id, status: "resolved", entity: { entityType: "unit", unit: state.unit }, facts: [fact("UNIT_RESOLVED", "Unidad activa resuelta.")] }
    : notFound(request.id);
  if (request.reference.source === "previous") return state.previousUnit
    ? { requestId: request.id, status: "resolved", entity: { entityType: "unit", unit: state.previousUnit }, facts: [fact("UNIT_RESOLVED", "Unidad anterior resuelta.")] }
    : notFound(request.id);
  const listed = listingEntity(request, state);
  if (listed) {
    const unit = units.find((candidate) => candidate.id === listed.id);
    return unit ? { requestId: request.id, status: "resolved", entity: { entityType: "unit", unit }, facts: [fact("UNIT_RESOLVED", "Unidad del listado resuelta.")] } : notFound(request.id);
  }
  const query = canonical(request.reference.expression);
  const codeQuery = canonicalUnitCode(request.reference.expression);
  if (!query) return { requestId: request.id, status: "invalid", errors: ["empty_unit_reference"] };
  const exact = units.filter((unit) => canonical(unit.id) === query || canonical(unit.plate ?? "") === query
    || canonicalUnitCode(unit.code ?? "") === codeQuery || canonicalUnitCode(unit.label) === codeQuery);
  const unique = [...new Map(exact.map((unit) => [unit.id, unit])).values()];
  if (unique.length === 1) return { requestId: request.id, status: "resolved", entity: { entityType: "unit", unit: unique[0]! }, facts: [fact("UNIT_RESOLVED", "Unidad resuelta.")] };
  if (unique.length > 1) return ambiguous(request.id, unique.map((unit, index) => ({ index: index + 1, entityType: "unit", id: unit.id, label: unit.label })));
  const partial = units.filter((unit) => [unit.label, unit.code ?? "", unit.plate ?? ""].some((value) => canonical(value).includes(query)));
  if (partial.length === 1) return { requestId: request.id, status: "resolved", entity: { entityType: "unit", unit: partial[0]! }, facts: [fact("UNIT_RESOLVED", "Unidad resuelta.")] };
  if (partial.length > 1) return ambiguous(request.id, partial.map((unit, index) => ({ index: index + 1, entityType: "unit", id: unit.id, label: unit.label })));
  return notFound(request.id);
}

export class LegacyEntityDirectoryAdapter implements EntityResolver {
  constructor(private readonly directory: CleanEntityDirectory) {}
  async resolve(requests: readonly ResolutionRequest[], state: ConversationStateClean): Promise<readonly ResolutionResult[]> {
    return requests.map((request) => request.entityType === "company"
      ? resolveCompany(request, state, this.directory.companies)
      : resolveUnit(request, state, this.directory.units));
  }
}
export const legacyEntityNormalization = Object.freeze({ canonical, canonicalUnitCode });
