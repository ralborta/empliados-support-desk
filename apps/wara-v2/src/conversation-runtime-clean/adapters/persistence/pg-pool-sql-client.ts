import { Pool, type PoolClient, type PoolConfig, type QueryResultRow } from "pg";
import type { SqlClient, SqlTransaction } from "./postgres-clean-persistence.js";

export type PgPoolSqlClientConfig = Readonly<{ connectionString: string; statementTimeoutMs: number; connectionTimeoutMs: number; maxConnections?: number }>;
function normalize<T extends Record<string, unknown>>(value: Readonly<{ rows: readonly QueryResultRow[]; rowCount: number | null }>) { return { rows: value.rows as readonly T[], rowCount: value.rowCount ?? value.rows.length }; }
class PgTransaction implements SqlTransaction {
  constructor(private readonly client: PoolClient) {}
  async query<T extends Record<string, unknown>>(sql: string, values: readonly unknown[] = []) { return normalize<T>(await this.client.query(sql, [...values])); }
}
export class PgPoolSqlClient implements SqlClient {
  private readonly pool: Pool; private readonly statementTimeoutMs: number;
  constructor(config: PgPoolSqlClientConfig) {
    if (!config.connectionString || !Number.isInteger(config.statementTimeoutMs) || config.statementTimeoutMs < 100 || !Number.isInteger(config.connectionTimeoutMs) || config.connectionTimeoutMs < 100) throw new Error("INVALID_CLEAN_SQL_CONFIG");
    const poolConfig: PoolConfig = { connectionString: config.connectionString, connectionTimeoutMillis: config.connectionTimeoutMs, max: config.maxConnections ?? 5, allowExitOnIdle: true };
    this.pool = new Pool(poolConfig); this.statementTimeoutMs = config.statementTimeoutMs;
  }
  async query<T extends Record<string, unknown>>(sql: string, values: readonly unknown[] = []) {
    const client = await this.pool.connect();
    try { await client.query("select set_config('statement_timeout', $1, false)", [`${this.statementTimeoutMs}ms`]); return normalize<T>(await client.query(sql, [...values])); }
    finally { client.release(); }
  }
  async transaction<T>(run: (tx: SqlTransaction) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("begin"); await client.query("select set_config('statement_timeout', $1, true)", [`${this.statementTimeoutMs}ms`]);
      const value = await run(new PgTransaction(client)); await client.query("commit"); return value;
    } catch (error) {
      try { await client.query("rollback"); } catch { /* preserve the original error */ }
      throw error;
    } finally { client.release(); }
  }
  async executeScript(sql: string): Promise<void> { await this.pool.query(sql); }
  async healthCheck(): Promise<boolean> { try { return (await this.query<{ healthy: number }>("select 1 as healthy")).rows[0]?.healthy === 1; } catch { return false; } }
  async close(): Promise<void> { await this.pool.end(); }
}
