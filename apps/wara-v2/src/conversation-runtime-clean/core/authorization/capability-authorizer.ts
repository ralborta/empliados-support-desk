import type { CapabilityAuthorizer } from "../ports/ports.js";
import type { TurnDecision } from "../types/decision.js";
import type { AuthorizationResult, AuthorizedOperation } from "../types/operation.js";
import type { PolicyViolation } from "../types/policy.js";
import type { ResolutionResult } from "../types/resolution.js";
import type { ConversationStateClean } from "../types/state.js";
import { getCleanCapability } from "./capability-catalog.js";
function blocked(code: string, detail: string): AuthorizationResult {
  const violation: PolicyViolation = { code, message: detail, severity: "blocking" };
  return { outcome: "blocked", violations: [violation] };
}
function resolutionIds(results: readonly ResolutionResult[]): ReadonlySet<string> {
  return new Set(results.filter((result) => result.status === "resolved").map((result) => result.requestId));
}
function hasField(field: string, args: Readonly<Record<string, unknown>>, state: ConversationStateClean, resolutions: readonly ResolutionResult[]): boolean {
  if (field === "company") return Boolean(state.company || resolutions.some((result) => result.status === "resolved" && result.entity.entityType === "company"));
  if (field === "unit") return Boolean(state.unit || resolutions.some((result) => result.status === "resolved" && result.entity.entityType === "unit"));
  if (field === "pendingOperation") return Boolean(state.pendingOperation);
  return args[field] !== undefined && args[field] !== null && args[field] !== "";
}
function bindingMatches(args: Readonly<Record<string, unknown>>, state: ConversationStateClean): boolean {
  const pending = state.pendingOperation;
  return Boolean(pending && args.operationId === pending.operationId && args.version === pending.version && args.payloadHash === pending.payloadHash
    && args.idempotencyKey === pending.idempotencyKey);
}
export class CleanCapabilityAuthorizer implements CapabilityAuthorizer {
  authorize(input: { decision: TurnDecision; state: ConversationStateClean; resolutions: readonly ResolutionResult[] }): AuthorizationResult {
    const resolved = resolutionIds(input.resolutions);
    const operations: AuthorizedOperation[] = [];
    for (const request of input.decision.requestedOperations) {
      const definition = getCleanCapability(request.capability);
      if (!definition) return blocked("UNKNOWN_CAPABILITY_BLOCKED", `Capability desconocida: ${request.capability}`);
      if (definition.kind !== request.kind || definition.task !== request.task) return blocked("CAPABILITY_CONTRACT_MISMATCH", `Contrato inválido para ${request.capability}`);
      if (request.requiredResolutionIds.some((id) => !resolved.has(id))) return blocked("UNRESOLVED_DEPENDENCY", `Resolución pendiente para ${request.capability}`);
      if (definition.requiredFields.some((field) => !hasField(field, request.arguments, input.state, input.resolutions))) return blocked("CAPABILITY_REQUIRED_FIELD_MISSING", `Faltan campos para ${request.capability}`);
      if (request.kind === "write_commit" && !bindingMatches(request.arguments, input.state)) return blocked("CONFIRMATION_BINDING_MATCH", `Binding inválido para ${request.capability}`);
      operations.push({ requestId: request.id, capability: request.capability, kind: request.kind, task: request.task, arguments: request.arguments, realWriteAllowed: false });
    }
    return { outcome: "authorized", operations };
  }
}
