import type { EntityResolver } from "../../core/ports/ports.js";
import type { ResolutionRequest } from "../../core/types/decision.js";
import type { ResolutionResult } from "../../core/types/resolution.js";
import type { CompanyState, ConversationStateClean, UnitState } from "../../core/types/state.js";
import { GuardedWaraAdapter } from "./guarded-wara-adapter.js";
import { matchUnitsByReference } from "./unit-reference-matcher.js";

type RemoteEntityData = Readonly<{ companies?: readonly unknown[]; units?: readonly unknown[]; unidades?: readonly unknown[] }>;
const fact = (code: string, text: string) => ({ code, source: "resolver" as const, text, verified: true });
function record(value: unknown): Record<string, unknown> | null { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function text(value: unknown): string | null { return typeof value === "string" || typeof value === "number" ? String(value).trim() || null : null; }
function normalizeCompany(value: unknown): CompanyState | null {
  const item = record(value); if (!item) return null;
  const id = text(item.id ?? item.contacto_id ?? item.contactoId); const name = text(item.name ?? item.nombre ?? item.empresa);
  return id && name ? { id, name } : null;
}
function normalizeUnit(value: unknown, fallbackCompanyId: string | undefined): UnitState | null {
  const item = record(value); if (!item) return null;
  const id = text(item.id ?? item.movil_id ?? item.movilId); const code = text(item.code ?? item.unidad ?? item.numero); const plate = text(item.plate ?? item.patente);
  const label = text(item.label) ?? [plate, code].filter(Boolean).join(" · "); const companyId = text(item.companyId ?? item.company_id ?? item.contacto_id) ?? fallbackCompanyId ?? null;
  if (!id || !label || !companyId) return null;
  return { id, label, code, plate, brand: text(item.brand ?? item.marca), model: text(item.model ?? item.modelo), companyId };
}
function canonical(value: string): string {
  let result = "";
  for (const character of value.normalize("NFD").toUpperCase()) {
    const code = character.codePointAt(0) ?? 0;
    if ((code >= 65 && code <= 90) || (code >= 48 && code <= 57)) result += character;
  }
  return result;
}
function matchCompanies(companies: readonly CompanyState[], expression: string): readonly CompanyState[] {
  const query = canonical(expression); if (!query) return companies;
  const exact = companies.filter((company) => canonical(company.id) === query || canonical(company.name) === query);
  if (exact.length) return exact;
  return companies.filter((company) => canonical(company.name).includes(query));
}
function active(request: ResolutionRequest, state: ConversationStateClean): ResolutionResult | null {
  if (request.reference.source === "active" && request.entityType === "company") return state.company ? { requestId: request.id, status: "resolved", entity: { entityType: "company", company: state.company }, facts: [fact("COMPANY_RESOLVED", "Empresa activa resuelta.")] } : { requestId: request.id, status: "not_found", facts: [] };
  if (request.reference.source === "active" && request.entityType === "unit") return state.unit ? { requestId: request.id, status: "resolved", entity: { entityType: "unit", unit: state.unit }, facts: [fact("UNIT_RESOLVED", "Unidad activa resuelta.")] } : { requestId: request.id, status: "not_found", facts: [] };
  if (request.reference.source === "previous" && request.entityType === "unit") return state.previousUnit ? { requestId: request.id, status: "resolved", entity: { entityType: "unit", unit: state.previousUnit }, facts: [fact("UNIT_RESOLVED", "Unidad anterior resuelta.")] } : { requestId: request.id, status: "not_found", facts: [] };
  return null;
}
export class WaraEntityResolver implements EntityResolver {
  constructor(private readonly wara: GuardedWaraAdapter, private readonly allowedTenants: ReadonlySet<string>, private readonly channel: Readonly<{ phone?: string }> = {}) {}
  async resolve(requests: readonly ResolutionRequest[], state: ConversationStateClean): Promise<readonly ResolutionResult[]> {
    const results: ResolutionResult[] = [];
    for (const request of requests) {
      const local = active(request, state); if (local) { results.push(local); continue; }
      const listed = request.reference.type === "listing_index" && request.reference.index && state.lastListing?.kind === request.entityType
        ? state.lastListing.items.find((item) => item.index === request.reference.index) : null;
      const effectiveReference = listed ? { ...request.reference, expression: listed.id, source: "last_presented" as const } : request.reference;
      const result = await this.wara.read<RemoteEntityData>({ capability: request.entityType === "company" ? "company.list" : "unit.search", tenant: { tenantId: state.tenantId, allowed: this.allowedTenants.has(state.tenantId) }, correlationId: request.id, authorized: true, query: { expression: effectiveReference.expression, source: effectiveReference.source,
        ...(effectiveReference.unitReferenceKind ? { referenceKind: effectiveReference.unitReferenceKind } : {}), ...(request.reference.index ? { index: request.reference.index } : {}),
        ...(request.entityType === "unit" ? { patentes: [] } : {}), ...(state.company ? { companyId: state.company.id } : {}), ...(this.channel.phone ? { phone: this.channel.phone } : {}) } });
      if (result.status === "success") {
        const items = request.entityType === "company"
          ? matchCompanies((result.data.companies ?? []).map(normalizeCompany).filter((item): item is CompanyState => Boolean(item)), effectiveReference.expression)
          : matchUnitsByReference((result.data.units ?? result.data.unidades ?? []).map((item) => normalizeUnit(item, state.company?.id)).filter((item): item is UnitState => Boolean(item)), effectiveReference);
        if (items.length === 1) results.push(request.entityType === "company" ? { requestId: request.id, status: "resolved", entity: { entityType: "company", company: items[0] as CompanyState }, facts: result.facts } : { requestId: request.id, status: "resolved", entity: { entityType: "unit", unit: items[0] as UnitState }, facts: result.facts });
        else if (items.length > 1) results.push({ requestId: request.id, status: "ambiguous", candidates: items.map((item, index) => ({ index: index + 1, entityType: request.entityType, id: item.id, label: "name" in item ? item.name : item.label })), facts: result.facts });
        else results.push({ requestId: request.id, status: "not_found", facts: result.facts });
      } else if (result.status === "not_found") results.push({ requestId: request.id, status: "not_found", facts: result.facts });
      else if (result.status === "validation_error") results.push({ requestId: request.id, status: "invalid", errors: result.errors });
      else results.push({ requestId: request.id, status: "backend_error", safeError: "entity_service_unavailable" });
    }
    return results;
  }
}
