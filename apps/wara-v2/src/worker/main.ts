/**
 * Worker stub Fase 1 — sin cola real, sin ConversationLock runtime aún (Fase 2/4).
 * Autoridad de lock documentada: PostgreSQL ConversationLock (ADR-040).
 * Redis: solo wakeup (no autoridad).
 */
import { PG_SOLE_LOCK_AUTHORITY } from "@wara-v2/contracts";
import { localEnvDefaults } from "@wara-v2/infra";
import { ALLOW_EXTERNAL_MUTATIONS } from "@wara-v2/executors";

export function describeWorkerStub() {
  return {
    service: "wara-v2-worker",
    phase: 1,
    mode: localEnvDefaults.WARA_V2_EXECUTION_MODE,
    pgSoleLockAuthority: PG_SOLE_LOCK_AUTHORITY,
    redisRole: localEnvDefaults.REDIS_ROLE,
    allowExternalMutations: ALLOW_EXTERNAL_MUTATIONS,
    processing: false,
    note: "Scaffold only. No queue consumer in Phase 1.",
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(describeWorkerStub(), null, 2));
}
