declare module "pg" {
  export type QueryResultRow = Record<string, unknown>;
  export type PoolConfig = { connectionString: string; connectionTimeoutMillis?: number; max?: number; allowExitOnIdle?: boolean };
  export type QueryResult = { rows: QueryResultRow[]; rowCount: number | null };
  export interface PoolClient { query(sql: string, values?: unknown[]): Promise<QueryResult>; release(): void; }
  export class Pool {
    constructor(config: PoolConfig);
    connect(): Promise<PoolClient>;
    query(sql: string, values?: unknown[]): Promise<QueryResult>;
    end(): Promise<void>;
  }
}
