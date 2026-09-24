export class DomainError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.details = details;
  }
}

export class InvalidTransitionError extends DomainError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("INVALID_TRANSITION", message, details);
    this.name = "InvalidTransitionError";
  }
}

export class GuardFailedError extends DomainError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("GUARD_FAILED", message, details);
    this.name = "GuardFailedError";
  }
}

export class InvariantError extends DomainError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("INVARIANT_VIOLATION", message, details);
    this.name = "InvariantError";
  }
}
