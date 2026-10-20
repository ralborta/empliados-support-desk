import type { AtomicCommitBundle, OutboxEvent, TransactionalOutbox } from "../../core/outbox/contracts.js";
import type { SqlClient } from "../persistence/postgres-clean-persistence.js";
import { isValidCleanNamespace } from "../../config/clean-config.js";

function rowToEvent(row: Record<string, unknown>): OutboxEvent {
  return { id: String(row.id), tenantId: String(row.tenant_id), aggregateType: String(row.aggregate_type), aggregateId: String(row.aggregate_id), eventType: String(row.event_type), payloadHash: String(row.payload_hash), idempotencyKey: String(row.idempotency_key), status: String(row.status) as OutboxEvent["status"], attempts: Number(row.attempts), nextAttemptAt: row.next_attempt_at ? new Date(String(row.next_attempt_at)).toISOString() : null };
}
export class PostgresTransactionalOutbox implements TransactionalOutbox {
  private readonly schema: string;
  constructor(private readonly sql: SqlClient, namespace: string) { if (!isValidCleanNamespace(namespace)) throw new Error("CLEAN_OUTBOX_UNSAFE_NAMESPACE"); this.schema = namespace; }
  async append<T>(bundle: AtomicCommitBundle<T>) {
    const result = await this.sql.query(`insert into ${this.schema}.outbox (id, tenant_id, aggregate_type, aggregate_id, event_type, payload_hash, idempotency_key, payload, status, attempts, next_attempt_at, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,clock_timestamp()) on conflict (tenant_id,idempotency_key) do nothing returning *`, [bundle.event.id, bundle.event.tenantId, bundle.event.aggregateType, bundle.event.aggregateId, bundle.event.eventType, bundle.event.payloadHash, bundle.event.idempotencyKey, JSON.stringify(bundle.payload), bundle.event.status, bundle.event.attempts, bundle.event.nextAttemptAt]);
    if (result.rows[0]) return { operationResult: bundle.operationResult, event: rowToEvent(result.rows[0]), duplicate: false };
    const prior = await this.sql.query(`select * from ${this.schema}.outbox where tenant_id=$1 and idempotency_key=$2`, [bundle.event.tenantId, bundle.event.idempotencyKey]);
    return { operationResult: bundle.operationResult, event: rowToEvent(prior.rows[0]!), duplicate: true };
  }
  async claim(eventId: string): Promise<OutboxEvent | null> {
    const result = await this.sql.query(`update ${this.schema}.outbox set status='processing', attempts=attempts+1 where id=$1 and status in ('pending','failed') and (next_attempt_at is null or next_attempt_at <= clock_timestamp()) returning *`, [eventId]);
    return result.rows[0] ? rowToEvent(result.rows[0]) : null;
  }
  async complete(eventId: string, outcome: "delivered" | "failed" | "dead_letter", nextAttemptAt: string | null = null): Promise<OutboxEvent | null> {
    const result = await this.sql.query(`update ${this.schema}.outbox set status=$2,next_attempt_at=$3 where id=$1 and status='processing' returning *`, [eventId, outcome, nextAttemptAt]);
    return result.rows[0] ? rowToEvent(result.rows[0]) : null;
  }
}
