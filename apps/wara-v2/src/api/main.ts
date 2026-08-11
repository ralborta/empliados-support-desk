/**
 * API stub Fase 6 — runtime local disponible vía workers; sin HTTP público aún.
 */
import { localEnvDefaults } from "@wara-v2/infra";
import { ALLOW_EXTERNAL_MUTATIONS } from "@wara-v2/executors";

export function describeApi() {
  return {
    service: "wara-v2-api",
    phase: 6,
    mode: localEnvDefaults.WARA_V2_EXECUTION_MODE,
    allowExternalMutations: ALLOW_EXTERNAL_MUTATIONS,
    listening: false,
    note: "Fase 6: composición runtime en worker/harness E2E. Sin endpoint público.",
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(describeApi(), null, 2));
}
