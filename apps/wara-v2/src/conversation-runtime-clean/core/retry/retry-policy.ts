import type { OperationKind } from "../types/interpretation.js";
import type { NormalizedServiceResult } from "../../adapters/services/normalized-service-result.js";

export type RetryPolicyConfig = Readonly<{ readMaxAttempts: number; prepareMaxAttempts: number; commitMaxAttempts: number; timeoutMs: number; backoffMs: readonly number[] }>;
export type RetryDecision = Readonly<{ action: "retry"; maxAttempts: number; timeoutMs: number; backoffMs: readonly number[]; requireSameIdempotencyKey: boolean }> | Readonly<{ action: "stop"; reason: string }>;

export function decideRetry<T>(input: { kind: OperationKind; result: NormalizedServiceResult<T>; idempotent: boolean; sameBinding: boolean; config: RetryPolicyConfig }): RetryDecision {
  const { kind, result, config } = input;
  if (["validation_error", "rejected", "unauthorized", "conflict", "not_found", "success", "pending"].includes(result.status)) return { action: "stop", reason: `terminal_${result.status}` };
  if (result.status !== "timeout" && result.status !== "backend_error") return { action: "stop", reason: "unknown_result" };
  if (kind === "read") return { action: "retry", maxAttempts: config.readMaxAttempts, timeoutMs: config.timeoutMs, backoffMs: config.backoffMs, requireSameIdempotencyKey: false };
  if (kind === "write_prepare" && input.idempotent) return { action: "retry", maxAttempts: config.prepareMaxAttempts, timeoutMs: config.timeoutMs, backoffMs: config.backoffMs, requireSameIdempotencyKey: true };
  if (kind === "write_commit" && input.idempotent && input.sameBinding) return { action: "retry", maxAttempts: config.commitMaxAttempts, timeoutMs: config.timeoutMs, backoffMs: config.backoffMs, requireSameIdempotencyKey: true };
  return { action: "stop", reason: "unsafe_retry" };
}
