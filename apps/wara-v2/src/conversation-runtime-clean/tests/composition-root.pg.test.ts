import assert from "node:assert/strict";
import { it } from "node:test";
import { PgPoolSqlClient } from "../adapters/persistence/pg-pool-sql-client.js";
import { runCleanMigration } from "../migrations/migration-runner.js";
import { startCleanLabApplication } from "../lab/composition-root.js";

function url(): string { const value = process.env.WARA_V2_DATABASE_URL; if (!value) throw new Error("PG_URL_REQUIRED"); const parsed = new URL(value); parsed.searchParams.delete("schema"); return parsed.toString(); }
const namespace = "wara_clean_app_test";
const baseEnv = { WARA_CLEAN_RUNTIME_ENABLED: "true", WARA_CLEAN_DATABASE_URL: "", WARA_CLEAN_PERSISTENCE_NAMESPACE: namespace, WARA_CLEAN_LAB_API_KEY: "app-key", WARA_CLEAN_LAB_TENANT_ALLOWLIST: "tenant-app", PORT: "0", GIT_COMMIT_SHA: "test-sha" };
async function migratedEnv() {
  const connectionString = url(); const sql = new PgPoolSqlClient({ connectionString, statementTimeoutMs: 5_000, connectionTimeoutMs: 5_000 });
  await runCleanMigration({ namespace, mode: "apply", admin: sql }); await sql.close(); return { ...baseEnv, WARA_CLEAN_DATABASE_URL: connectionString };
}
async function turn(baseUrl: string, messageId: string) {
  return fetch(`${baseUrl}/api/wara-clean-lab/turn`, { method: "POST", headers: { authorization: "Bearer app-key", "content-type": "application/json" }, body: JSON.stringify({ tenantId: "tenant-app", sessionId: "session-app", messageId, message: "synthetic fixture" }) });
}
it("starts the enabled composition, persists, resumes and deduplicates with zero effects", async () => {
  const env = await migratedEnv(); const first = await startCleanLabApplication(env);
  try {
    const health = await fetch(`${first.server.baseUrl}/api/wara-clean-lab/health`); const healthValue = await health.json() as { commit: string; persistence: string; externalWritesEnabled: boolean; deliveryEnabled: boolean };
    assert.equal(healthValue.commit, "test-sha"); assert.equal(healthValue.persistence, "configured"); assert.equal(healthValue.externalWritesEnabled, false); assert.equal(healthValue.deliveryEnabled, false);
    const response = await turn(first.server.baseUrl, "m1"); assert.equal(response.status, 200); const value = await response.json() as { writes: { attempted: boolean; executed: boolean } }; assert.deepEqual(value.writes, { attempted: false, executed: false });
  } finally { await first.close(); }
  const second = await startCleanLabApplication(env);
  try {
    assert.equal((await turn(second.server.baseUrl, "m2")).status, 200); assert.equal((await turn(second.server.baseUrl, "m2")).status, 200);
  } finally { await second.close(); }
  const sql = new PgPoolSqlClient({ connectionString: env.WARA_CLEAN_DATABASE_URL, statementTimeoutMs: 5_000, connectionTimeoutMs: 5_000 });
  try {
    const state = await sql.query<{ version: string; turn_sequence: string }>(`select version::text,turn_sequence::text from ${namespace}.conversation_state where tenant_id=$1 and conversation_id=$2`, ["tenant-app", "session-app"]); assert.deepEqual(state.rows[0], { version: "2", turn_sequence: "2" });
    const effects = await sql.query<{ outbox: string; attempts: string }>(`select (select count(*)::text from ${namespace}.outbox) as outbox,(select count(*)::text from ${namespace}.operation_attempt) as attempts`); assert.deepEqual(effects.rows[0], { outbox: "0", attempts: "0" });
  } finally { await sql.close(); }
});
