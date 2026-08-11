/**
 * WARA V2 Executors — Fase 5 (simulador local only).
 */
export const PHASE = 5 as const;

export {
  GUARANTEES,
  ALLOW_EXTERNAL_MUTATIONS,
  ALLOW_LOCAL_SIMULATOR_ONLY,
  assertPhase5Guarantees,
} from "./guarantees.js";
export {
  assertLocalSimulatorUrl,
  assertNoRealServiceEnv,
  isRedirectForbidden,
  LOCAL_SIMULATOR_DESTINATION_KEY,
} from "./allowlist.js";
export {
  classifyAttemptResult,
  mayAutoRetry,
  requiresReconcile,
  toDomainEvent,
  toAttemptOutcome,
  type ResultClassification,
} from "./classification.js";
export {
  buildEffectIdempotencyKey,
  requestFingerprint,
  backoffMs,
  maxAttempts,
} from "./idempotency.js";
export { startLocalSimulator, type LocalSimulator, type SimScenario } from "./simulator/local-server.js";
export {
  postToLocalSimulator,
  reconcileLocalSimulator,
} from "./simulator/client.js";
export { validatePreHttp } from "./prehttp/validate.js";
export { prepareEffectOutbox } from "./outbox/prepare.js";
export { OutboxDispatcher } from "./outbox/dispatcher.js";
export { EffectReconciler } from "./reconcile/reconciler.js";
export {
  assertDeliveryGateAllowsLocalEffect,
  simulatorGatePass,
  type DeliveryGateSnapshot,
} from "./delivery/gate-bridge.js";

import type { ExecutorResult } from "@wara-v2/contracts";

export const EXECUTORS_STUB = false as const;

export function dryRunDenied(tool: string): ExecutorResult {
  return {
    status: "denied",
    data: { tool, reason: "real_mutations_disabled" },
    missing_fields: [],
    warnings: ["ALLOW_EXTERNAL_MUTATIONS=false"],
    error: {
      code: "MUTATIONS_DISABLED",
      message: "Real WARA/Odoo/WhatsApp mutations disabled (Phase 5)",
    },
  };
}
