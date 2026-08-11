/**
 * Única puerta hacia prepareEffectOutbox: exige DeliveryGate evaluado.
 * Ningún otro módulo debe llamar prepareEffectOutbox directamente en runtime.
 */
import type { PrismaClient } from "@wara-v2/db";
import {
  prepareEffectOutbox,
  type PrepareEffectResult,
  type DeliveryGateSnapshot,
} from "@wara-v2/executors";
import {
  evaluateDeliveryGate,
  type DeliveryGateRequest,
  type DeliveryGateResult,
} from "./types.js";

export function toDeliveryGateSnapshot(
  gate: DeliveryGateResult,
): DeliveryGateSnapshot {
  const checksPass = Object.values(gate.checks).every(Boolean);
  return {
    allowExternalEffect: false,
    outcome: gate.outcome,
    reasons: gate.reasons,
    checksPass: checksPass && gate.outcome !== "denied",
  };
}

export async function gatedPrepareEffect(
  prisma: PrismaClient,
  gateReq: DeliveryGateRequest,
  prepareInput: Omit<
    Parameters<typeof prepareEffectOutbox>[1],
    "deliveryGate"
  >,
): Promise<
  | { ok: true; gate: DeliveryGateResult; prepare: Extract<PrepareEffectResult, { ok: true }> }
  | { ok: false; gate: DeliveryGateResult; reason: string }
> {
  const gate = evaluateDeliveryGate(gateReq);
  if (gate.outcome === "denied" || gate.allowExternalEffect !== false) {
    return { ok: false, gate, reason: "delivery_gate_denied" };
  }
  const snap = toDeliveryGateSnapshot(gate);
  // Solo simulador local: prepareEffectOutbox revalida allowlist
  const prepare = await prepareEffectOutbox(prisma, {
    ...prepareInput,
    deliveryGate: snap,
  });
  if (!prepare.ok) {
    return { ok: false, gate, reason: prepare.reason };
  }
  return { ok: true, gate, prepare };
}

/** Detector de bypass: prepareEffectOutbox no debe importarse fuera de este módulo en app/runtime. */
export const GATED_PREPARE_ONLY = true as const;
