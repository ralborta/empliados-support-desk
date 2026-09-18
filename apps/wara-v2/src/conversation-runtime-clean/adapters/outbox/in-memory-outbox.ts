import type { AtomicCommitBundle, OutboxEvent, TransactionalOutbox } from "../../core/outbox/contracts.js";
import { validateOutboxBundle } from "../../core/outbox/contracts.js";

export class InMemoryTransactionalOutbox implements TransactionalOutbox {
  private readonly events = new Map<string, OutboxEvent>();
  private readonly keys = new Map<string, string>();
  constructor(private readonly knownSchemas: ReadonlySet<string>) {}
  async append<T>(bundle: AtomicCommitBundle<T>): Promise<Readonly<{ operationResult: T; event: OutboxEvent; duplicate: boolean }>> {
    const errors = validateOutboxBundle(bundle, this.knownSchemas);
    if (errors.length) throw new Error(errors.join(","));
    const priorId = this.keys.get(bundle.event.idempotencyKey);
    if (priorId) return { operationResult: bundle.operationResult, event: this.events.get(priorId)!, duplicate: true };
    this.events.set(bundle.event.id, bundle.event); this.keys.set(bundle.event.idempotencyKey, bundle.event.id);
    return { operationResult: bundle.operationResult, event: bundle.event, duplicate: false };
  }
  async claim(eventId: string): Promise<OutboxEvent | null> {
    const current = this.events.get(eventId);
    if (!current || current.status !== "pending") return null;
    const next: OutboxEvent = { ...current, status: "processing", attempts: current.attempts + 1 };
    this.events.set(eventId, next); return next;
  }
  async complete(eventId: string, outcome: "delivered" | "failed" | "dead_letter", nextAttemptAt: string | null = null): Promise<OutboxEvent | null> {
    const current = this.events.get(eventId);
    if (!current || current.status !== "processing") return null;
    const next: OutboxEvent = { ...current, status: outcome, nextAttemptAt };
    this.events.set(eventId, next); return next;
  }
}
