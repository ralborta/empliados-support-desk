/**
 * Stub Fase 1 — dominio V2 (máquina de estados / ConversationLock SQL en Fase 2+).
 */
export {
  OperationStatusSchema,
  ConversationLockSchema,
  PG_SOLE_LOCK_AUTHORITY,
  type OperationStatus,
  type ConversationLock,
} from "@wara-v2/contracts";

export const PHASE = 1 as const;
export const DOMAIN_STUB = true as const;
