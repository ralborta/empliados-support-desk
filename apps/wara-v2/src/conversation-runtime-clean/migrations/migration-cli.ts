import { loadCleanRuntimeConfig } from "../config/clean-config.js";
import { PgPoolSqlClient } from "../adapters/persistence/pg-pool-sql-client.js";
import { parseCleanMigrationMode, runCleanMigration } from "./migration-runner.js";

async function main() {
  const mode = parseCleanMigrationMode(process.argv.slice(2));
  const config = loadCleanRuntimeConfig(process.env); let sql: PgPoolSqlClient | undefined;
  try {
    if (mode === "apply") { const url = process.env.WARA_CLEAN_DATABASE_URL?.trim(); if (!url) throw new Error("WARA_CLEAN_DATABASE_URL_REQUIRED"); sql = new PgPoolSqlClient({ connectionString: url, statementTimeoutMs: 120_000, connectionTimeoutMs: 5_000 }); }
    const result = await runCleanMigration({ namespace: config.persistenceNamespace, mode, ...(sql ? { admin: sql } : {}) });
    if (mode === "dry-run" && "sql" in result && typeof result.sql === "string") process.stdout.write(result.sql); else console.log(JSON.stringify(result));
  } finally { await sql?.close(); }
}
void main().catch((error) => { console.error(error instanceof Error ? error.message : "CLEAN_MIGRATION_FAILED"); process.exit(1); });
