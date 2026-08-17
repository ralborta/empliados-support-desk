import type { CleanRuntimeConfig } from "../../config/clean-config.js";
import type { Clock } from "../../core/persistence/contracts.js";
import type { OutboxEvent, TransactionalOutbox } from "../../core/outbox/contracts.js";

export type DeliveryResult = Readonly<{ status: "delivered" } | { status: "retryable_failure"; retryAt: string } | { status: "permanent_failure" }>;
export interface OutboxDeliveryDispatcher { deliver(event: OutboxEvent): Promise<DeliveryResult>; }
export class GuardedOutboxWorker {
  constructor(private readonly config: CleanRuntimeConfig, private readonly outbox: TransactionalOutbox, private readonly dispatcher: OutboxDeliveryDispatcher, private readonly clock: Clock) {}
  async dispatchOne(eventId: string): Promise<Readonly<{ status: "blocked" | "not_claimed" | "delivered" | "failed" | "dead_letter" }>> {
    if (!this.config.runtimeEnabled || !this.config.deliveryEnabled) return { status: "blocked" };
    const claimed = await this.outbox.claim(eventId); if (!claimed) return { status: "not_claimed" };
    try {
      const result = await this.dispatcher.deliver(claimed);
      if (result.status === "delivered") { await this.outbox.complete(eventId, "delivered"); return { status: "delivered" }; }
      if (result.status === "retryable_failure") {
        const retryAt = new Date(result.retryAt); const valid = Number.isFinite(retryAt.valueOf()) && retryAt > this.clock.now();
        await this.outbox.complete(eventId, valid ? "failed" : "dead_letter", valid ? retryAt.toISOString() : null);
        return { status: valid ? "failed" : "dead_letter" };
      }
      await this.outbox.complete(eventId, "dead_letter"); return { status: "dead_letter" };
    } catch { await this.outbox.complete(eventId, "failed"); return { status: "failed" }; }
  }
}

