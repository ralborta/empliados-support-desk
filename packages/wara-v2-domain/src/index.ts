/**
 * WARA V2 — dominio y máquina de estados Operation (Fase 3).
 * Persistencia solo vía @wara-v2/db + WARA_V2_DATABASE_URL.
 * Mutaciones externas deshabilitadas (dry_run).
 */
export const PHASE = 3 as const;
export const DOMAIN_STUB = false as const;

export {
  OperationStatusSchema,
  ConversationLockSchema,
  PG_SOLE_LOCK_AUTHORITY,
  V2_DEFAULTS,
  type OperationStatus,
  type ConversationLock,
} from "@wara-v2/contracts";

export * from "./errors.js";
export * from "./operation/statuses.js";
export * from "./operation/events.js";
export * from "./operation/transition-table.js";
export * from "./operation/types.js";
export {
  resolveTransition,
  evaluateGuards,
  assertConfirmationCoherence,
} from "./operation/state-machine.js";
export {
  OperationDomainService,
  hashPayload,
  assertCanExecute,
  ATTEMPT_APPEND_ONLY_POLICY,
} from "./operation/service.js";
export type {
  OperationRepository,
  UnitOfWork,
  ApplyCommand,
  CreateOperationInput,
  AppendEventInput,
  CreateAttemptInput,
  CreateConfirmationInput,
} from "./ports/operation-repository.js";
export {
  InMemoryOperationRepository,
  InMemoryUnitOfWork,
} from "./persistence/in-memory-operation-repository.js";
export {
  PrismaOperationRepository,
  PrismaUnitOfWork,
} from "./persistence/prisma-operation-repository.js";
