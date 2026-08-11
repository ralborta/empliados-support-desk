/**
 * Estados y terminalidad — fuente canónica: docs/v2/WARA-MODELO-DE-DATOS-V2.md §4.1
 */
import {
  OperationStatusSchema,
  type OperationStatus,
} from "@wara-v2/contracts";

export const OPERATION_STATUSES = OperationStatusSchema.options;

export const TERMINAL_STATUSES = [
  "succeeded",
  "permanent_failed",
  "cancelled",
  "expired",
  "superseded",
] as const satisfies readonly OperationStatus[];

export type TerminalStatus = (typeof TERMINAL_STATUSES)[number];

/** Estados que cuentan como “activos para commit” (índice parcial PG). */
export const ACTIVE_FOR_COMMIT_STATUSES = [
  "draft",
  "collecting_data",
  "awaiting_confirmation",
  "confirmed",
  "queued",
  "processing",
  "cancel_requested",
  "retryable_failed",
  "unknown_outcome",
  "reconciling",
  "suspended",
] as const satisfies readonly OperationStatus[];

export function isTerminalStatus(status: OperationStatus): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(status);
}

export function isActiveForCommit(status: OperationStatus): boolean {
  return (ACTIVE_FOR_COMMIT_STATUSES as readonly string[]).includes(status);
}

/** Estados desde los cuales supersede / context_incompatible están prohibidos. */
export const SUPERSEDE_FORBIDDEN_STATUSES = [
  "processing",
  "cancel_requested",
  "unknown_outcome",
  "reconciling",
] as const satisfies readonly OperationStatus[];

export function isSupersedeForbidden(status: OperationStatus): boolean {
  return (SUPERSEDE_FORBIDDEN_STATUSES as readonly string[]).includes(status);
}
