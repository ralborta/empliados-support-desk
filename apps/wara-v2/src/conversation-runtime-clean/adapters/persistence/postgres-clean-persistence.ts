import type { CleanAtomicTurnCommit, CleanCommitResult, CleanPersistenceRepository, CleanPersistenceSnapshot } from "../../core/persistence/contracts.js";

export interface SqlTransaction {
  query<T extends Record<string, unknown> = Record<string, unknown>>(sql: string, values?: readonly unknown[]): Promise<Readonly<{ rows: readonly T[]; rowCount: number }>>;
}
export interface SqlClient extends SqlTransaction { transaction<T>(run: (tx: SqlTransaction) => Promise<T>): Promise<T>; }

function assertIdentifier(namespace: string): string {
  if (!/^[a-z][a-z0-9_]{2,62}$/.test(namespace)) throw new Error("CLEAN_PERSISTENCE_UNSAFE_NAMESPACE");
  return namespace;
}

export class PostgresCleanPersistence implements CleanPersistenceRepository {
  private readonly schema: string;
  constructor(private readonly sql: SqlClient, namespace: string) { this.schema = assertIdentifier(namespace); }

  async load(input: { tenantId: string; conversationId: string }): Promise<CleanPersistenceSnapshot | null> {
    const result = await this.sql.query<{ snapshot: CleanPersistenceSnapshot }>(
      `select ${this.schema}.load_snapshot($1, $2) as snapshot`, [input.tenantId, input.conversationId],
    );
    return result.rows[0]?.snapshot ?? null;
  }

  async commitTurn(input: CleanAtomicTurnCommit): Promise<CleanCommitResult> {
    return this.sql.transaction(async (tx) => {
      const result = await tx.query<{ status: "committed" | "duplicate"; snapshot: CleanPersistenceSnapshot }>(
        `select status, snapshot from ${this.schema}.commit_turn($1::jsonb)`, [JSON.stringify(input)],
      );
      const row = result.rows[0];
      if (!row) throw new Error("CLEAN_PERSISTENCE_COMMIT_FAILED");
      return { status: row.status, record: row.snapshot.state };
    });
  }
}

