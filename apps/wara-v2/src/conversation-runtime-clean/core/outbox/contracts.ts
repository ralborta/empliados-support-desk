export type OutboxEventStatus = "pending" | "processing" | "delivered" | "failed" | "dead_letter";
export type OutboxEvent = Readonly<{
  id: string; tenantId: string; aggregateType: string; aggregateId: string; eventType: string;
  payloadHash: string; idempotencyKey: string; status: OutboxEventStatus; attempts: number; nextAttemptAt: string | null;
}>;
export type OutboxPayload = Readonly<{ schema: string; values: Readonly<Record<string, string | number | boolean | null>> }>;
export type PendingOutboxEvent = OutboxEvent & Readonly<{ status: "pending"; attempts: 0 }>;
export type AtomicCommitBundle<T> = Readonly<{ operationResult: T; event: PendingOutboxEvent; payload: OutboxPayload }>;

export interface TransactionalOutbox {
  append<T>(bundle: AtomicCommitBundle<T>): Promise<Readonly<{ operationResult: T; event: OutboxEvent; duplicate: boolean }>>;
  claim(eventId: string): Promise<OutboxEvent | null>;
  complete(eventId: string, outcome: "delivered" | "failed" | "dead_letter", nextAttemptAt?: string | null): Promise<OutboxEvent | null>;
}

export function validateOutboxBundle<T>(bundle: AtomicCommitBundle<T>, knownSchemas: ReadonlySet<string>): readonly string[] {
  const errors: string[] = [];
  const event = bundle.event;
  if (!event.id || !event.tenantId || !event.aggregateType || !event.aggregateId || !event.eventType || !event.payloadHash || !event.idempotencyKey) errors.push("incomplete_outbox_event");
  if (!knownSchemas.has(bundle.payload.schema)) errors.push("unknown_payload_schema");
  return errors;
}
