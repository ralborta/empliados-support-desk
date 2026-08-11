/**
 * Gateway stub Fase 1 — sin listen productivo, sin BBC, sin mutaciones.
 * dry_run / shadow: DeliveryGate suppress (fases posteriores).
 */
import { V2_DEFAULTS } from "@wara-v2/contracts";
import { localEnvDefaults } from "@wara-v2/infra";

export function describeApiStub() {
  return {
    service: "wara-v2-api",
    phase: 1,
    mode: localEnvDefaults.WARA_V2_EXECUTION_MODE,
    defaults: V2_DEFAULTS,
    listening: false,
    whatsappSend: false,
    note: "Scaffold only. No HTTP server bound in Phase 1.",
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(describeApiStub(), null, 2));
}
