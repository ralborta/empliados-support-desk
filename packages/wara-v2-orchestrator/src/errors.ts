export class OrchestratorError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "OrchestratorError";
    this.code = code;
    this.details = details;
  }
}
