/**
 * Clasificación de resultados de intento (Fase 5).
 */
export type ResultClassification =
  | "success"
  | "permanent_failure"
  | "retryable_failure"
  | "timeout_before_send"
  | "timeout_after_send"
  | "ambiguous_result"
  | "unknown_outcome"
  | "duplicate_idempotent"
  | "denied_pre_http";

export type SimulatorHttpPhase =
  | "before_connect"
  | "connected_before_write"
  | "after_request_written"
  | "response_received";

export type ClassifyInput = {
  /** true si el request dejó el socket hacia el simulador. */
  requestLikelySent: boolean;
  httpStatus?: number | null;
  errorCode?: string | null;
  bodyOk?: boolean;
  preHttpDenied?: boolean;
  duplicateIdempotent?: boolean;
  phase?: SimulatorHttpPhase;
};

export function classifyAttemptResult(input: ClassifyInput): ResultClassification {
  if (input.preHttpDenied) return "denied_pre_http";
  if (input.duplicateIdempotent) return "duplicate_idempotent";

  if (input.errorCode === "TIMEOUT" || input.errorCode === "ABORT") {
    if (!input.requestLikelySent || input.phase === "before_connect" || input.phase === "connected_before_write") {
      return "timeout_before_send";
    }
    return "timeout_after_send";
  }

  if (input.errorCode === "CONNECTION_RESET_AFTER_WRITE") {
    return "unknown_outcome";
  }

  if (input.errorCode === "MALFORMED_RESPONSE") {
    return input.requestLikelySent ? "unknown_outcome" : "ambiguous_result";
  }

  if (input.httpStatus != null) {
    if (input.httpStatus >= 200 && input.httpStatus < 300 && input.bodyOk) {
      return "success";
    }
    if (input.httpStatus === 409) return "duplicate_idempotent";
    if (input.httpStatus >= 400 && input.httpStatus < 500 && input.httpStatus !== 408 && input.httpStatus !== 429) {
      return "permanent_failure";
    }
    if (input.httpStatus >= 500 || input.httpStatus === 408 || input.httpStatus === 429) {
      return "retryable_failure";
    }
  }

  if (input.errorCode === "RETRYABLE") return "retryable_failure";
  if (input.errorCode === "PERMANENT") return "permanent_failure";

  return "ambiguous_result";
}

/** unknown_outcome / timeout_after_send → no reintento ciego; reconciliar. */
export function mayAutoRetry(classification: ResultClassification): boolean {
  return (
    classification === "retryable_failure" ||
    classification === "timeout_before_send" ||
    classification === "denied_pre_http"
  );
}

export function requiresReconcile(classification: ResultClassification): boolean {
  return (
    classification === "unknown_outcome" ||
    classification === "timeout_after_send" ||
    classification === "ambiguous_result"
  );
}

export function toDomainEvent(classification: ResultClassification): string {
  switch (classification) {
    case "success":
      return "attempt_success";
    case "permanent_failure":
      return "attempt_permanent_failed";
    case "retryable_failure":
    case "timeout_before_send":
    case "denied_pre_http":
      return classification === "timeout_before_send"
        ? "timeout_before_send"
        : "attempt_retryable_failed";
    case "timeout_after_send":
      return "timeout_after_send";
    case "unknown_outcome":
    case "ambiguous_result":
      return "ambiguous_result";
    case "duplicate_idempotent":
      return "attempt_success";
    default:
      return "ambiguous_result";
  }
}

export function toAttemptOutcome(
  classification: ResultClassification,
):
  | "confirmed_success"
  | "confirmed_failure"
  | "retryable_failed"
  | "permanent_failed"
  | "timeout_before_send"
  | "timeout_after_send"
  | "unknown_outcome"
  | "not_sent"
  | "sent_awaiting" {
  switch (classification) {
    case "success":
    case "duplicate_idempotent":
      return "confirmed_success";
    case "permanent_failure":
      return "permanent_failed";
    case "retryable_failure":
      return "retryable_failed";
    case "timeout_before_send":
    case "denied_pre_http":
      return "timeout_before_send";
    case "timeout_after_send":
      return "timeout_after_send";
    case "unknown_outcome":
    case "ambiguous_result":
      return "unknown_outcome";
    default:
      return "unknown_outcome";
  }
}
