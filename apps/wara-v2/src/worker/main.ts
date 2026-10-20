/**
 * Worker V2 Fase 6 — turn / outbox / reconcile locales.
 * Sin BBC, sin WhatsApp, sin mutaciones reales.
 */
import { PG_SOLE_LOCK_AUTHORITY } from "@wara-v2/contracts";
import { localEnvDefaults } from "@wara-v2/infra";
import { ALLOW_EXTERNAL_MUTATIONS } from "@wara-v2/executors";
import {
  createV2Runtime,
  startOutboxWorker,
  startReconcileWorker,
} from "../runtime/compose.js";

export function describeWorker() {
  return {
    service: "wara-v2-worker",
    phase: 6,
    mode: localEnvDefaults.WARA_V2_EXECUTION_MODE,
    pgSoleLockAuthority: PG_SOLE_LOCK_AUTHORITY,
    redisRole: localEnvDefaults.REDIS_ROLE,
    allowExternalMutations: ALLOW_EXTERNAL_MUTATIONS,
    processing: true,
    note: "Local workers: outbox + reconcile against simulator only.",
  };
}

async function main() {
  if (!process.env.WARA_V2_DATABASE_URL) {
    console.log(JSON.stringify(describeWorker(), null, 2));
    return;
  }
  const rt = await createV2Runtime();
  const outbox = startOutboxWorker(rt, { intervalMs: 200 });
  const reconcile = startReconcileWorker(rt, { intervalMs: 500 });
  console.log(JSON.stringify({ ...describeWorker(), started: true }, null, 2));
  const shutdown = async () => {
    await outbox.stop();
    await reconcile.stop();
    await rt.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
