import { CleanOptimisticConflictError, CleanOperationConflictError, CleanPersistenceInputError, CleanPersistenceUnavailableError } from "../persistence/contracts.js";

export type CleanRuntimeErrorCode =
  | "INVALID_REQUEST" | "UNAUTHENTICATED" | "TENANT_FORBIDDEN" | "DUPLICATE_MESSAGE_REPLAY"
  | "OPTIMISTIC_CONFLICT" | "OPERATION_CONFLICT" | "STATE_INVARIANT_VIOLATION"
  | "PERSISTENCE_UNAVAILABLE" | "INTERNAL_ERROR" | "RATE_LIMITED" | "RUNTIME_DISABLED" | "NOT_FOUND";

const ERROR_METADATA: Readonly<Record<CleanRuntimeErrorCode, Readonly<{ status: number; retryable: boolean }>>> = Object.freeze({
  INVALID_REQUEST: { status: 400, retryable: false }, UNAUTHENTICATED: { status: 401, retryable: false },
  TENANT_FORBIDDEN: { status: 403, retryable: false }, DUPLICATE_MESSAGE_REPLAY: { status: 200, retryable: false },
  OPTIMISTIC_CONFLICT: { status: 409, retryable: true }, OPERATION_CONFLICT: { status: 409, retryable: false },
  STATE_INVARIANT_VIOLATION: { status: 500, retryable: false }, PERSISTENCE_UNAVAILABLE: { status: 503, retryable: true },
  INTERNAL_ERROR: { status: 500, retryable: false }, RATE_LIMITED: { status: 429, retryable: true },
  RUNTIME_DISABLED: { status: 503, retryable: true }, NOT_FOUND: { status: 404, retryable: false },
});

export class CleanRuntimeError extends Error {
  readonly status: number; readonly retryable: boolean;
  constructor(readonly code: CleanRuntimeErrorCode, readonly traceId: string, readonly diagnosticCode?: string, options?: ErrorOptions) {
    super(code, options); this.name = "CleanRuntimeError"; this.status = ERROR_METADATA[code].status; this.retryable = ERROR_METADATA[code].retryable;
  }
}

export class CleanStateInvariantError extends Error {
  constructor(readonly violationCodes: readonly string[]) { super("CLEAN_STATE_INVARIANT_VIOLATION"); this.name = "CleanStateInvariantError"; }
}

export function normalizeCleanRuntimeError(error: unknown, traceId: string): CleanRuntimeError {
  if (error instanceof CleanRuntimeError) return error;
  if (error instanceof CleanStateInvariantError) return new CleanRuntimeError("STATE_INVARIANT_VIOLATION", traceId, error.violationCodes.join(","), { cause: error });
  if (error instanceof CleanOptimisticConflictError) return new CleanRuntimeError("OPTIMISTIC_CONFLICT", traceId, undefined, { cause: error });
  if (error instanceof CleanOperationConflictError) return new CleanRuntimeError("OPERATION_CONFLICT", traceId, undefined, { cause: error });
  if (error instanceof CleanPersistenceUnavailableError) return new CleanRuntimeError("PERSISTENCE_UNAVAILABLE", traceId, undefined, { cause: error });
  if (error instanceof CleanPersistenceInputError) return new CleanRuntimeError("INVALID_REQUEST", traceId, undefined, { cause: error });
  return new CleanRuntimeError("INTERNAL_ERROR", traceId, undefined, { cause: error });
}

export function cleanErrorBody(error: CleanRuntimeError): Readonly<{ error: Readonly<{ code: CleanRuntimeErrorCode; traceId: string; retryable: boolean }> }> {
  return { error: { code: error.code, traceId: error.traceId, retryable: error.retryable } };
}
