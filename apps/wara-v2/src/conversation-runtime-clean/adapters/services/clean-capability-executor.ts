import type { CapabilityExecutor } from "../../core/ports/ports.js";
import type { KnowledgeRepository } from "../../core/knowledge/contracts.js";
import type { AuthorizedOperation, OperationExecutionResult } from "../../core/types/operation.js";
import type { ConversationStateClean } from "../../core/types/state.js";
import type { NormalizedServiceResult } from "./normalized-service-result.js";
import { GuardedWaraAdapter, type WaraReadCapability, type WaraWriteCapability } from "./guarded-wara-adapter.js";
import { GuardedOdooHandoffAdapter } from "./guarded-odoo-handoff-adapter.js";
import { unitStatusFacts } from "./unit-status-facts.js";

function execution(operation: AuthorizedOperation, result: NormalizedServiceResult<unknown>, extraFacts = result.status === "success" ? result.facts : []): OperationExecutionResult {
  const status = result.status === "success" || result.status === "pending" ? "success"
    : result.status === "not_found" ? "not_found"
    : result.status === "backend_error" || result.status === "timeout" ? "backend_error"
    : result.status === "validation_error" || result.status === "conflict" ? "invalid" : "blocked";
  return { requestId: operation.requestId, capability: operation.capability, status, facts: "facts" in result ? extraFacts : [], ...(result.status === "success" ? { data: result.data } : {}), writeAttempt: operation.kind === "write_commit", writeExecuted: operation.kind === "write_commit" && operation.realWriteAllowed && result.status === "success" };
}
function binding(operation: AuthorizedOperation) {
  return { operationId: String(operation.arguments.operationId ?? ""), version: Number(operation.arguments.version ?? 0), payloadHash: String(operation.arguments.payloadHash ?? ""), idempotencyKey: String(operation.arguments.idempotencyKey ?? "") };
}
function pendingBinding(state: ConversationStateClean) {
  const value = state.pendingOperation; return value ? { operationId: value.operationId, version: value.version, payloadHash: value.payloadHash, idempotencyKey: value.idempotencyKey } : undefined;
}
const WARA_READS = new Set(["company.list", "company.get_active", "unit.search", "unit.get_active", "unit.get_previous", "gps.get_status"]);
const WARA_WRITES = new Set(["odometer.update", "hourmeter.update", "maintenance.create", "certificate.issue"]);
export class CleanOperationalCapabilityExecutor implements CapabilityExecutor {
  constructor(private readonly wara: GuardedWaraAdapter, private readonly odoo: GuardedOdooHandoffAdapter, private readonly knowledge: KnowledgeRepository, private readonly allowedTenants: ReadonlySet<string>,
    private readonly clock: Readonly<{ now(): Date }> = { now: () => new Date() }, private readonly timeZone = "America/Argentina/Buenos_Aires", private readonly channel: Readonly<{ phone?: string }> = {}) {}
  async execute(operations: readonly AuthorizedOperation[], state: ConversationStateClean): Promise<readonly OperationExecutionResult[]> {
    const values: OperationExecutionResult[] = [];
    for (const operation of operations) {
      const tenant = { tenantId: state.tenantId, allowed: this.allowedTenants.has(state.tenantId) }; const correlationId = operation.requestId;
      let result: NormalizedServiceResult<unknown>;
      if (operation.kind === "write_prepare") result = { status: "success", data: { preparedArguments: operation.arguments }, facts: [] };
      else if (WARA_READS.has(operation.capability)) result = await this.wara.read({ capability: operation.capability as WaraReadCapability, tenant, correlationId, authorized: true, query: { ...operation.arguments, ...(state.company ? { companyId: state.company.id } : {}), ...(this.channel.phone ? { phone: this.channel.phone } : {}) } });
      else if (WARA_WRITES.has(operation.capability)) result = await this.wara.write({ capability: operation.capability as WaraWriteCapability, tenant, correlationId, authorized: operation.realWriteAllowed, payload: operation.arguments, binding: binding(operation), pendingBinding: pendingBinding(state) });
      else if (operation.capability === "ticket.get_status") result = await this.odoo.ticketStatus({ tenant, correlationId, authorized: true, ticketId: String(operation.arguments.ticketId ?? "") });
      else if (operation.capability.startsWith("ticket.") && operation.capability.endsWith(".commit")) {
        const action = operation.capability.slice(7, -7) as "create" | "update" | "close" | "reopen";
        result = await this.odoo.ticketWrite({ tenant, correlationId, authorized: operation.realWriteAllowed, binding: binding(operation), pendingBinding: pendingBinding(state), action, ticketId: typeof operation.arguments.ticketId === "string" ? operation.arguments.ticketId : undefined, subject: typeof operation.arguments.subject === "string" ? operation.arguments.subject : undefined, detail: typeof operation.arguments.detail === "string" ? operation.arguments.detail : undefined, idempotencyKey: String(operation.arguments.idempotencyKey ?? "") });
      } else if (operation.capability.startsWith("conversation.") && operation.capability.endsWith(".commit")) {
        const action = operation.capability.slice(13, -7) as "handoff" | "assign" | "release";
        result = await this.odoo.conversationWrite({ tenant, correlationId, authorized: operation.realWriteAllowed, binding: binding(operation), pendingBinding: pendingBinding(state), action, conversationId: state.conversationId, reason: typeof operation.arguments.detail === "string" ? operation.arguments.detail : undefined });
      } else if (operation.capability === "domain.answer") {
        const found = await this.knowledge.retrieve({ scope: { tenantId: state.tenantId, companyId: state.company?.id, domain: String(operation.arguments.domain ?? "platform") }, topicId: String(operation.arguments.topicId ?? operation.arguments.goal ?? ""), limit: 5 });
        result = found.status === "found" ? { status: "success", data: found, facts: found.passages.map((passage) => ({ code: passage.id, source: "capability" as const, text: passage.text, verified: true })) } : found.status === "not_found" ? { status: "not_found", facts: [] } : { status: "backend_error", safeError: "knowledge_unavailable" };
      } else result = { status: "rejected", code: "capability_adapter_unavailable", facts: [] };
      const facts = operation.capability === "gps.get_status" && result.status === "success"
        ? [...result.facts, ...unitStatusFacts(result.data, { timeZone: this.timeZone, now: this.clock.now() })]
        : result.status === "success" ? result.facts : [];
      values.push(execution(operation, result, facts));
    }
    return values;
  }
}
