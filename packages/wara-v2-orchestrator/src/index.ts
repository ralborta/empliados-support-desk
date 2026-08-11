/**
 * WARA V2 — Orquestador Fase 4 (Policy + DeliveryGate).
 * Sin HTTP externo. dry_run + V2_MUTATIONS_DISABLED.
 */
export const PHASE = 4 as const;
export const ORCHESTRATOR_STUB = false as const;

export {
  MODEL_CANNOT_ORDER_COMMIT,
  PG_SOLE_LOCK_AUTHORITY,
  parseOrchestratorDecision,
  type OrchestratorDecision,
  type PolicyDecision,
} from "@wara-v2/contracts";

export {
  GUARANTEES,
  assertPhase4Guarantees,
} from "./guarantees.js";
export * from "./types.js";
export * from "./errors.js";
export { buildTurnContext, routeIntent } from "./context/build-context.js";
export {
  FakeModelAdapter,
  FailingModelAdapter,
  InvalidJsonModelAdapter,
  defaultFakeDecision,
  type ModelAdapter,
} from "./model/adapters.js";
export {
  buildPolicyDecision,
  assertNoModelOrderedCommit,
} from "./policy/engine.js";
export { compareActsByPrecedence, actPrecedence } from "./policy/precedence.js";
export {
  evaluateDeliveryGate,
  goalAllowed,
  type DeliveryGateRequest,
  type DeliveryGateResult,
} from "./delivery/gate.js";
export { TurnPipeline, type TurnPipelineDeps } from "./pipeline/turn-pipeline.js";
export {
  InMemoryTurnStore,
  InMemoryLockPort,
  InMemoryIngressPort,
  InMemoryOutboxPort,
  type TurnStore,
  type LockPort,
  type IngressPort,
  type OutboxPort,
} from "./persistence/ports.js";
export { composeResponse } from "./composer/response.js";
export {
  executeStubTool,
  assertNoExternalSideEffects,
} from "./tools/stub-executor.js";
