import type { ResolutionResult, ResolvedEntity } from "../types/resolution.js";
import type { OperationalFact } from "../types/response.js";
import type { CompanyState, PendingOperationState, UnitState } from "../types/state.js";

export type KernelResult<T> =
  | Readonly<{ status: "resolved"; value: T; facts: readonly OperationalFact[] }>
  | Readonly<{ status: "not_found"; facts: readonly OperationalFact[] }>
  | Readonly<{ status: "ambiguous"; facts: readonly OperationalFact[] }>
  | Readonly<{ status: "invalid"; errors: readonly string[] }>
  | Readonly<{ status: "backend_error"; safeError: string }>;

export function companySelect(result: ResolutionResult): KernelResult<CompanyState> {
  if (result.status === "resolved" && result.entity.entityType === "company") return { status: "resolved", value: result.entity.company, facts: result.facts };
  return resolutionFailure(result, "company");
}
export function unitSelect(result: ResolutionResult): KernelResult<UnitState> {
  if (result.status === "resolved" && result.entity.entityType === "unit") return { status: "resolved", value: result.entity.unit, facts: result.facts };
  return resolutionFailure(result, "unit");
}
function resolutionFailure<T>(result: ResolutionResult, expected: ResolvedEntity["entityType"]): KernelResult<T> {
  if (result.status === "not_found") return { status: "not_found", facts: result.facts };
  if (result.status === "ambiguous") return { status: "ambiguous", facts: result.facts };
  if (result.status === "invalid") return { status: "invalid", errors: result.errors };
  if (result.status === "backend_error") return { status: "backend_error", safeError: result.safeError };
  return { status: "invalid", errors: [`expected_${expected}_resolution`] };
}

export type OperationBinding = Readonly<{ operationId: string; capability: string; taskId: string; version: number; payloadHash: string; idempotencyKey: string }>;
export type PreparedOperationInput = OperationBinding & Readonly<{ arguments: Readonly<Record<string, unknown>> }>;
export function operationPrepare(input: PreparedOperationInput): KernelResult<PendingOperationState> {
  if (!input.operationId || !input.capability || !input.taskId || input.version <= 0 || !input.payloadHash || !input.idempotencyKey) return { status: "invalid", errors: ["incomplete_operation_binding"] };
  return { status: "resolved", value: { operationId: input.operationId, capability: input.capability, taskId: input.taskId, version: input.version,
    payloadHash: input.payloadHash, idempotencyKey: input.idempotencyKey, preparedArguments: input.arguments, status: "awaiting_confirmation" }, facts: [] };
}
export function operationCorrect(input: { pending: PendingOperationState; corrections: Readonly<Record<string, unknown>> }): KernelResult<Readonly<{ preparedArguments: Readonly<Record<string, unknown>>; pendingOperation: null }>> {
  if (Object.keys(input.corrections).length === 0) return { status: "invalid", errors: ["empty_correction"] };
  return { status: "resolved", value: { preparedArguments: { ...input.pending.preparedArguments, ...input.corrections }, pendingOperation: null }, facts: [] };
}
export function operationConfirm(input: { pending: PendingOperationState; binding: OperationBinding }): KernelResult<PendingOperationState> {
  const { pending, binding } = input;
  if (pending.operationId !== binding.operationId || pending.capability !== binding.capability || pending.taskId !== binding.taskId
    || pending.version !== binding.version || pending.payloadHash !== binding.payloadHash || pending.idempotencyKey !== binding.idempotencyKey) return { status: "invalid", errors: ["confirmation_binding_mismatch"] };
  return { status: "resolved", value: pending, facts: [] };
}
export function operationCancel(input: { pending: PendingOperationState | null }): KernelResult<null> {
  if (!input.pending) return { status: "not_found", facts: [] };
  return { status: "resolved", value: null, facts: [] };
}
