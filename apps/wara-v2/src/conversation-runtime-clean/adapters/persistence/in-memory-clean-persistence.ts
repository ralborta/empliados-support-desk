import { createEmptyCleanState } from "../../core/types/state.js";
import type { OutboxEvent, OutboxPayload } from "../../core/outbox/contracts.js";
import { CleanOperationConflictError, CleanOptimisticConflictError, type CleanAtomicTurnCommit, type CleanCommitResult, type CleanDedupeRecord, type CleanPersistenceRepository, type CleanPersistenceSnapshot, type CleanStateRecord, type Clock } from "../../core/persistence/contracts.js";

type MutableAggregate = {
  record: CleanStateRecord; dedupe: Map<string, CleanDedupeRecord>; outbox: Map<string, { event: OutboxEvent; payload: OutboxPayload }>;
  attempts: NonNullable<CleanAtomicTurnCommit["attempts"]>; traces: NonNullable<CleanAtomicTurnCommit["trace"]>[];
};

export class InMemoryCleanPersistence implements CleanPersistenceRepository {
  private readonly aggregates = new Map<string, MutableAggregate>();
  private readonly tenantMessages = new Map<string, CleanDedupeRecord>();
  private failBeforeCommit = false;
  constructor(private readonly clock: Clock) {}
  private key(tenantId: string, conversationId: string): string { return `${tenantId}\u0000${conversationId}`; }
  simulateFailureOnce(): void { this.failBeforeCommit = true; }

  async load(input: { tenantId: string; conversationId: string }): Promise<CleanPersistenceSnapshot | null> {
    const value = this.aggregates.get(this.key(input.tenantId, input.conversationId));
    if (!value) return null;
    return structuredClone({ state: value.record, tasks: value.record.state.tasks, pendingOperation: value.record.state.pendingOperation, listing: value.record.state.lastListing, attempts: value.attempts, traces: value.traces });
  }

  async findReplay(input: { tenantId: string; conversationId: string; messageId: string }) {
    const duplicate = this.tenantMessages.get(`${input.tenantId}\u0000${input.messageId}`);
    if (!duplicate) return null;
    if (duplicate.conversationId !== input.conversationId) throw new CleanOperationConflictError();
    const aggregate = this.aggregates.get(this.key(input.tenantId, input.conversationId));
    if (!aggregate) return null;
    return { record: structuredClone(aggregate.record), replayResult: structuredClone(duplicate.replayResult) };
  }

  async loadOrCreate(input: { tenantId: string; conversationId: string }): Promise<CleanStateRecord> {
    const found = await this.load(input);
    if (found) return found.state;
    const now = this.clock.now().toISOString();
    return { ...input, version: 0, turnSequence: 0, schemaVersion: "clean-1", state: createEmptyCleanState(input), updatedAt: now };
  }

  async commitTurn(input: CleanAtomicTurnCommit): Promise<CleanCommitResult> {
    const key = this.key(input.tenantId, input.conversationId);
    const current = this.aggregates.get(key);
    const currentRecord = current?.record ?? await this.loadOrCreate(input);
    const duplicate = this.tenantMessages.get(`${input.tenantId}\u0000${input.messageId}`);
    if (duplicate && duplicate.conversationId !== input.conversationId) throw new CleanOperationConflictError();
    if (duplicate) return { status: "duplicate", record: structuredClone(currentRecord), replayResult: structuredClone(duplicate.replayResult) };
    if (currentRecord.version !== input.expectedVersion) throw new CleanOptimisticConflictError();
    if (input.nextState.tenantId !== input.tenantId || input.nextState.conversationId !== input.conversationId) throw new Error("CLEAN_PERSISTENCE_TENANT_SCOPE_MISMATCH");
    if (input.outbox && input.outbox.event.tenantId !== input.tenantId) throw new Error("CLEAN_PERSISTENCE_OUTBOX_TENANT_MISMATCH");
    if (this.failBeforeCommit) { this.failBeforeCommit = false; throw new Error("CLEAN_PERSISTENCE_SIMULATED_FAILURE"); }

    const now = this.clock.now().toISOString();
    const nextRecord: CleanStateRecord = { tenantId: input.tenantId, conversationId: input.conversationId, version: currentRecord.version + 1, turnSequence: currentRecord.turnSequence + 1, schemaVersion: input.nextState.metadata.schemaVersion, state: structuredClone(input.nextState), updatedAt: now };
    const next: MutableAggregate = {
      record: nextRecord,
      dedupe: new Map(current?.dedupe ?? []), outbox: new Map(current?.outbox ?? []),
      attempts: [...(current?.attempts ?? []), ...(input.attempts ?? [])], traces: [...(current?.traces ?? []), ...(input.trace ? [input.trace] : [])],
    };
    next.dedupe.set(input.messageId, { tenantId: input.tenantId, messageId: input.messageId, conversationId: input.conversationId, turnSequence: nextRecord.turnSequence, replayResult: structuredClone(input.replayResult), createdAt: now });
    if (input.outbox) {
      const prior = [...next.outbox.values()].find(({ event }) => event.tenantId === input.tenantId && event.idempotencyKey === input.outbox!.event.idempotencyKey);
      if (!prior) next.outbox.set(input.outbox.event.id, structuredClone(input.outbox));
    }
    this.aggregates.set(key, next);
    this.tenantMessages.set(`${input.tenantId}\u0000${input.messageId}`, next.dedupe.get(input.messageId)!);
    return { status: "committed", record: structuredClone(nextRecord), replayResult: structuredClone(input.replayResult) };
  }

  outboxSize(tenantId: string, conversationId: string): number { return this.aggregates.get(this.key(tenantId, conversationId))?.outbox.size ?? 0; }
}
