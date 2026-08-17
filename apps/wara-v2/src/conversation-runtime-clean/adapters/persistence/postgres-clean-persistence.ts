import type { CleanAtomicTurnCommit, CleanCommitResult, CleanPersistenceRepository, CleanPersistenceSnapshot } from "../../core/persistence/contracts.js";
import { CleanOptimisticConflictError } from "../../core/persistence/contracts.js";
import { isValidCleanNamespace } from "../../config/clean-config.js";

export interface SqlTransaction {
  query<T extends Record<string, unknown> = Record<string, unknown>>(sql: string, values?: readonly unknown[]): Promise<Readonly<{ rows: readonly T[]; rowCount: number }>>;
}
export interface SqlClient extends SqlTransaction {
  transaction<T>(run: (tx: SqlTransaction) => Promise<T>): Promise<T>;
  healthCheck(): Promise<boolean>;
  close(): Promise<void>;
}
export class CleanPersistenceInputError extends Error { constructor() { super("CLEAN_PERSISTENCE_INVALID_INPUT"); } }
export class CleanPersistenceUnavailableError extends Error { constructor(cause?: unknown) { super("CLEAN_PERSISTENCE_UNAVAILABLE", { cause }); } }

function schemaName(namespace: string): string {
  if (!isValidCleanNamespace(namespace)) throw new Error("CLEAN_PERSISTENCE_UNSAFE_NAMESPACE");
  return namespace;
}
function errorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && typeof (error as { code?: unknown }).code === "string" ? (error as { code: string }).code : undefined;
}

export class PostgresCleanPersistence implements CleanPersistenceRepository {
  private readonly schema: string;
  constructor(private readonly sql: SqlClient, namespace: string) { this.schema = schemaName(namespace); }
  async load(input: { tenantId: string; conversationId: string }): Promise<CleanPersistenceSnapshot | null> {
    try {
      const result = await this.sql.query<{ snapshot: CleanPersistenceSnapshot | null }>(`select ${this.schema}.load_snapshot($1, $2) as snapshot`, [input.tenantId, input.conversationId]);
      return result.rows[0]?.snapshot ?? null;
    } catch (error) { throw this.mapError(error); }
  }
  async commitTurn(input: CleanAtomicTurnCommit): Promise<CleanCommitResult> {
    try {
      return await this.sql.transaction(async (tx) => {
        const result = await tx.query<{ status: "committed" | "duplicate"; snapshot: CleanPersistenceSnapshot }>(`select status, snapshot from ${this.schema}.commit_turn($1::jsonb)`, [JSON.stringify(input)]);
        const row = result.rows[0];
        if (!row?.snapshot?.state) throw new CleanPersistenceUnavailableError();
        return { status: row.status, record: row.snapshot.state };
      });
    } catch (error) { throw this.mapError(error); }
  }
  healthCheck(): Promise<boolean> { return this.sql.healthCheck(); }
  close(): Promise<void> { return this.sql.close(); }
  private mapError(error: unknown): Error {
    const code = errorCode(error);
    if (code === "CR001") return new CleanOptimisticConflictError();
    if (code === "CR002") return new CleanPersistenceInputError();
    if (error instanceof CleanOptimisticConflictError || error instanceof CleanPersistenceInputError || error instanceof CleanPersistenceUnavailableError) return error;
    return new CleanPersistenceUnavailableError(error);
  }
}
