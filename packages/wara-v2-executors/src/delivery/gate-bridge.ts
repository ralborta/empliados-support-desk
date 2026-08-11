/**
 * Puente estructural con DeliveryGate (Fase 4) sin importar orchestrator
 * (evita dependencia circular orchestrator → executors → orchestrator).
 */
export type DeliveryGateSnapshot = {
  /** Siempre false para destinos reales. */
  allowExternalEffect: false;
  outcome: "simulated" | "suppressed" | "denied";
  reasons: string[];
  /** true solo si todos los checks críticos del gate pasaron. */
  checksPass: boolean;
};

/** Gate “verde” para harness local (simulador). */
export function simulatorGatePass(): DeliveryGateSnapshot {
  return {
    allowExternalEffect: false,
    outcome: "simulated",
    reasons: [],
    checksPass: true,
  };
}

export function assertDeliveryGateAllowsLocalEffect(
  gate: DeliveryGateSnapshot,
): { ok: true } | { ok: false; reason: string } {
  if (gate.allowExternalEffect !== false) {
    return { ok: false, reason: "gate_allow_external_effect_must_be_false" };
  }
  if (gate.outcome === "denied" || !gate.checksPass) {
    return {
      ok: false,
      reason: `delivery_gate_denied:${gate.reasons.join(",") || "checks"}`,
    };
  }
  if (gate.outcome !== "simulated" && gate.outcome !== "suppressed") {
    return { ok: false, reason: "delivery_gate_outcome_invalid" };
  }
  return { ok: true };
}
