import { loadCleanRuntimeConfig } from "../config/clean-config.js";
import { PgPoolSqlClient } from "../adapters/persistence/pg-pool-sql-client.js";
import { runCleanMigration, type CleanMigrationMode } from "./migration-runner.js";

async function main() {
  const argument = process.argv[2] ?? "--check"; const mode: CleanMigrationMode = argument === "--apply" ? "apply" : argument === "--dry-run" ? "dry-run" : argument === "--check" ? "check" : (() => { throw new Error("CLEAN_MIGRATION_MODE_INVALID"); })();
  const config = loadCleanRuntimeConfig(process.env); let sql: PgPoolSqlClient | undefined;
  try {
    if (mode === "apply") { const url = process.env.WARA_CLEAN_DATABASE_URL?.trim(); if (!url) throw new Error("WARA_CLEAN_DATABASE_URL_REQUIRED"); sql = new PgPoolSqlClient({ connectionString: url, statementTimeoutMs: 120_000, connectionTimeoutMs: 5_000 }); }
    const result = await runCleanMigration({ namespace: config.persistenceNamespace, mode, ...(sql ? { admin: sql } : {}) });
    if (mode === "dry-run" && "sql" in result && typeof result.sql === "string") process.stdout.write(result.sql); else console.log(JSON.stringify(result));
  } finally { await sql?.close(); }
}
void main().catch((error) => { console.error(error instanceof Error ? error.message : "CLEAN_MIGRATION_FAILED"); process.exit(1); });
