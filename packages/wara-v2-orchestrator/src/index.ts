/**
 * Stub Fase 1 — orquestador (structured output en fases posteriores).
 * El modelo propone OrchestratorDecision; nunca ejecuta commit.
 */
export {
  parseOrchestratorDecision,
  MODEL_CANNOT_ORDER_COMMIT,
  type OrchestratorDecision,
} from "@wara-v2/contracts";

export const PHASE = 1 as const;
export const ORCHESTRATOR_STUB = true as const;
