import type { EntityResolver } from "../../core/ports/ports.js";
import type { ResolutionRequest } from "../../core/types/decision.js";
import type { ResolutionResult } from "../../core/types/resolution.js";
import type { CompanyState, ConversationStateClean, UnitState } from "../../core/types/state.js";
import { GuardedWaraAdapter } from "./guarded-wara-adapter.js";

type RemoteEntityData = Readonly<{ companies?: readonly CompanyState[]; units?: readonly UnitState[] }>;
const fact = (code: string, text: string) => ({ code, source: "resolver" as const, text, verified: true });
function active(request: ResolutionRequest, state: ConversationStateClean): ResolutionResult | null {
  if (request.reference.source === "active" && request.entityType === "company") return state.company ? { requestId: request.id, status: "resolved", entity: { entityType: "company", company: state.company }, facts: [fact("COMPANY_RESOLVED", "Empresa activa resuelta.")] } : { requestId: request.id, status: "not_found", facts: [] };
  if (request.reference.source === "active" && request.entityType === "unit") return state.unit ? { requestId: request.id, status: "resolved", entity: { entityType: "unit", unit: state.unit }, facts: [fact("UNIT_RESOLVED", "Unidad activa resuelta.")] } : { requestId: request.id, status: "not_found", facts: [] };
  if (request.reference.source === "previous" && request.entityType === "unit") return state.previousUnit ? { requestId: request.id, status: "resolved", entity: { entityType: "unit", unit: state.previousUnit }, facts: [fact("UNIT_RESOLVED", "Unidad anterior resuelta.")] } : { requestId: request.id, status: "not_found", facts: [] };
  return null;
}
export class WaraEntityResolver implements EntityResolver {
  constructor(private readonly wara: GuardedWaraAdapter, private readonly allowedTenants: ReadonlySet<string>) {}
  async resolve(requests: readonly ResolutionRequest[], state: ConversationStateClean): Promise<readonly ResolutionResult[]> {
    const results: ResolutionResult[] = [];
    for (const request of requests) {
      const local = active(request, state); if (local) { results.push(local); continue; }
      const result = await this.wara.read<RemoteEntityData>({ capability: request.entityType === "company" ? "company.list" : "unit.search", tenant: { tenantId: state.tenantId, allowed: this.allowedTenants.has(state.tenantId) }, correlationId: request.id, authorized: true, query: { expression: request.reference.expression, source: request.reference.source, ...(request.reference.index ? { index: request.reference.index } : {}), ...(state.company ? { companyId: state.company.id } : {}) } });
      if (result.status === "success") {
        const items = request.entityType === "company" ? result.data.companies ?? [] : result.data.units ?? [];
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
