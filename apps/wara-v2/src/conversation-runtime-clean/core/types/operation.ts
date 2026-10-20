import type { OperationKind, TaskType } from "./interpretation.js";
import type { PolicyViolation } from "./policy.js";
import type { OperationalFact } from "./response.js";
export type AuthorizedOperation = Readonly<{
  requestId: string; capability: string; kind: OperationKind; task: TaskType;
  arguments: Readonly<Record<string, unknown>>; realWriteAllowed: false;
}>;
export type AuthorizationResult = Readonly<{ outcome: "authorized"; operations: readonly AuthorizedOperation[] }> | Readonly<{ outcome: "blocked"; violations: readonly PolicyViolation[] }>;
export type OperationExecutionResult = Readonly<{ requestId: string; capability: string; status: "success" | "not_found" | "invalid" | "backend_error" | "blocked"; facts: readonly OperationalFact[]; data?: unknown; writeAttempt: boolean; writeExecuted: boolean }>;
