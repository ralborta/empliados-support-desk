/**
 * Eventos de dominio Operation — alineados a §4.3 (+ reject/create explícitos para matriz mínima).
 */
export const OPERATION_EVENTS = [
  "create",
  "prepare_incomplete",
  "prepare_complete",
  "confirm_valid",
  "reject",
  "correct_payload",
  "supersede",
  "cancel",
  "expire",
  "context_incompatible",
  "context_compatible",
  "enqueue_commit",
  "start_attempt",
  "attempt_success",
  "attempt_retryable_failed",
  "attempt_permanent_failed",
  "timeout_before_send",
  "timeout_after_send",
  "ambiguous_result",
  "user_cancel",
  "start_reconcile",
  "reconcile_confirmed_success",
  "reconcile_confirmed_absent",
  "reconcile_ambiguous",
  "retry_allowed",
] as const;

export type OperationDomainEvent = (typeof OPERATION_EVENTS)[number];

export function isOperationDomainEvent(v: string): v is OperationDomainEvent {
  return (OPERATION_EVENTS as readonly string[]).includes(v);
}
