import type { TurnOutcome, ExecutionMode, Channel } from "@wara-v2/contracts";
import type { OperationRecord } from "@wara-v2/domain";
import type { TraceEvent } from "../types.js";

export type PersistedTurn = {
  id: string;
  conversationId: string;
  idempotencyKey: string;
  outcome: TurnOutcome;
  mode: ExecutionMode;
  fencingToken: bigint | null;
  ownerId: string | null;
  decision: unknown;
  policy: unknown;
  responsePlan: unknown;
};

export type TurnStore = {
  findByIdempotencyKey(key: string): Promise<PersistedTurn | null>;
  /** Crea fila stub del turno (permite FK outbox antes del finish). */
  beginTurn?(turn: {
    id: string;
    conversationId: string;
    idempotencyKey: string;
    ownerId: string;
    fencingToken: bigint;
    mode: ExecutionMode;
  }): Promise<void>;
  saveTurn(turn: PersistedTurn, traces: TraceEvent[]): Promise<void>;
  /** Simula fallo de persistencia. */
  failNextSave?: boolean;
};

export type LockHandle = {
  fencingToken: bigint;
  ownerId: string;
  leaseExpiresAt: Date;
};

export type LockPort = {
  acquire(conversationId: string, ownerId: string, leaseMs?: number): Promise<LockHandle | null>;
  release(conversationId: string, ownerId: string, fencingToken: bigint): Promise<boolean>;
  renew?(
    conversationId: string,
    ownerId: string,
    fencingToken: bigint,
    leaseMs?: number,
  ): Promise<boolean>;
};

export type OperationPort = {
  listActive(conversationId: string): Promise<OperationRecord[]>;
  get(id: string): Promise<OperationRecord | null>;
};

export type IngressPort = {
  /** Returns true if first accept; false if duplicate same hash; throws on conflict. */
  accept(input: {
    provider: string;
    channelAccountId: string;
    externalMessageId: string;
    conversationId: string;
    payloadHash: string;
  }): Promise<"accepted" | "duplicate" | "duplicate_conflict">;
};

export class InMemoryTurnStore implements TurnStore {
  turns = new Map<string, PersistedTurn>();
  byKey = new Map<string, string>();
  traces = new Map<string, TraceEvent[]>();
  failNextSave = false;

  async findByIdempotencyKey(key: string) {
    const id = this.byKey.get(key);
    return id ? this.turns.get(id) ?? null : null;
  }

  async beginTurn(turn: {
    id: string;
    conversationId: string;
    idempotencyKey: string;
    ownerId: string;
    fencingToken: bigint;
    mode: ExecutionMode;
  }) {
    this.turns.set(turn.id, {
      id: turn.id,
      conversationId: turn.conversationId,
      idempotencyKey: turn.idempotencyKey,
      outcome: "ok_simulated",
      mode: turn.mode,
      fencingToken: turn.fencingToken,
      ownerId: turn.ownerId,
      decision: null,
      policy: null,
      responsePlan: null,
    });
    this.byKey.set(turn.idempotencyKey, turn.id);
  }

  async saveTurn(turn: PersistedTurn, traces: TraceEvent[]) {
    if (this.failNextSave) {
      this.failNextSave = false;
      throw new Error("persistence_failure");
    }
    this.turns.set(turn.id, turn);
    this.byKey.set(turn.idempotencyKey, turn.id);
    this.traces.set(turn.id, traces);
  }
}

export class InMemoryLockPort implements LockPort {
  private locks = new Map<
    string,
    { ownerId: string; fencingToken: bigint; leaseExpiresAt: Date }
  >();

  async acquire(conversationId: string, ownerId: string, leaseMs = 30_000) {
    const now = Date.now();
    const cur = this.locks.get(conversationId);
    if (cur && cur.leaseExpiresAt.getTime() > now && cur.ownerId !== ownerId) {
      return null;
    }
    const fencingToken = cur ? cur.fencingToken + 1n : 1n;
    const handle = {
      ownerId,
      fencingToken,
      leaseExpiresAt: new Date(now + leaseMs),
    };
    this.locks.set(conversationId, handle);
    return handle;
  }

  async release(conversationId: string, ownerId: string, fencingToken: bigint) {
    const cur = this.locks.get(conversationId);
    if (!cur || cur.ownerId !== ownerId || cur.fencingToken !== fencingToken) {
      return false;
    }
    cur.leaseExpiresAt = new Date(0);
    return true;
  }

  /** Test helper: force expire */
  expire(conversationId: string) {
    const cur = this.locks.get(conversationId);
    if (cur) cur.leaseExpiresAt = new Date(0);
  }
}

export class InMemoryIngressPort implements IngressPort {
  private rows = new Map<string, { hash: string; status: string }>();

  async accept(input: {
    provider: string;
    channelAccountId: string;
    externalMessageId: string;
    conversationId: string;
    payloadHash: string;
  }) {
    const key = `${input.provider}|${input.channelAccountId}|${input.externalMessageId}`;
    const existing = this.rows.get(key);
    if (!existing) {
      this.rows.set(key, { hash: input.payloadHash, status: "accepted" });
      return "accepted";
    }
    if (existing.hash === input.payloadHash) return "duplicate";
    return "duplicate_conflict";
  }
}

export type OutboxPort = {
  enqueue(input: {
    turnId: string;
    conversationId: string;
    channel: Channel;
    channelAccountId: string;
    payload: unknown;
    payloadHash: string;
    idempotencyKey: string;
    status: "suppressed" | "pending";
    suppressReason: string;
  }): Promise<void>;
};

export class InMemoryOutboxPort implements OutboxPort {
  items: Array<Record<string, unknown>> = [];
  async enqueue(input: {
    turnId: string;
    conversationId: string;
    channel: Channel;
    channelAccountId: string;
    payload: unknown;
    payloadHash: string;
    idempotencyKey: string;
    status: "suppressed" | "pending";
    suppressReason: string;
  }) {
    this.items.push({ ...input, executionMode: "dry_run" });
  }
}
