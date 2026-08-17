import { createHash, randomUUID } from "node:crypto";
import type { ConversationSaveContext, ConversationStore } from "../../core/ports/ports.js";
import type { Clock, CleanPersistenceRepository } from "../../core/persistence/contracts.js";
import type { ConversationStateClean } from "../../core/types/state.js";

export class AtomicCleanConversationStore implements ConversationStore {
  constructor(private readonly repository: CleanPersistenceRepository, private readonly clock: Clock, private readonly expectedVersion: number, private readonly messageId: string, private readonly deliveryEnabled: boolean) {}
  async save(state: ConversationStateClean, context?: ConversationSaveContext): Promise<void> {
    const reply = context?.reply ?? ""; const traceId = context?.traceId ?? randomUUID(); const now = this.clock.now().toISOString();
    const outbox = this.deliveryEnabled ? { event: { id: randomUUID(), tenantId: state.tenantId, aggregateType: "conversation", aggregateId: state.conversationId, eventType: "reply.ready", payloadHash: createHash("sha256").update(reply).digest("hex"), idempotencyKey: `reply:${state.tenantId}:${this.messageId}`, status: "pending" as const, attempts: 0 as const, nextAttemptAt: null }, payload: { schema: "reply.ready.v1", values: { conversationId: state.conversationId, messageId: this.messageId, reply, traceId } } } : undefined;
    await this.repository.commitTurn({ tenantId: state.tenantId, conversationId: state.conversationId, expectedVersion: this.expectedVersion, messageId: this.messageId, nextState: state, outbox, trace: traceId ? { traceId, tenantId: state.tenantId, conversationId: state.conversationId, messageId: this.messageId, turnSequence: this.expectedVersion + 1, runtimeVersion: "clean-1", createdAt: now } : undefined });
  }
}
