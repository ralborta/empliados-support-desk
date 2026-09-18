/**
 * Adaptadores Prisma V2 — locks PG reales, ingress/turns/outbox/ops durables.
 */
import { randomUUID } from "node:crypto";
import type { PrismaClient, Prisma } from "@wara-v2/db";
import type { Channel } from "@wara-v2/contracts";
import type { OperationRecord } from "@wara-v2/domain";
import type {
  IngressPort,
  LockHandle,
  LockPort,
  OperationPort,
  OutboxPort,
  PersistedTurn,
  TurnStore,
} from "./ports.js";
import type { TraceEvent } from "../types.js";

export class PrismaLockPort implements LockPort {
  constructor(private readonly prisma: PrismaClient) {}

  async acquire(
    conversationId: string,
    ownerId: string,
    leaseMs = 30_000,
  ): Promise<LockHandle | null> {
    const seconds = Math.max(1, Math.ceil(leaseMs / 1000));
    const rows = await this.prisma.$queryRawUnsafe<
      Array<{
        owner_id: string | null;
        fencing_token: bigint;
        lease_expires_at: Date;
      }>
    >(
      `SELECT owner_id, fencing_token, lease_expires_at
       FROM wara_v2_acquire_conversation_lock($1, $2, make_interval(secs => $3))`,
      conversationId,
      ownerId,
      seconds,
    );
    const row = rows[0];
    if (!row || row.owner_id !== ownerId) return null;
    return {
      ownerId: row.owner_id,
      fencingToken: BigInt(row.fencing_token),
      leaseExpiresAt: new Date(row.lease_expires_at),
    };
  }

  async renew(
    conversationId: string,
    ownerId: string,
    fencingToken: bigint,
    leaseMs = 30_000,
  ): Promise<boolean> {
    const seconds = Math.max(1, Math.ceil(leaseMs / 1000));
    const rows = await this.prisma.$queryRawUnsafe<unknown[]>(
      `SELECT * FROM wara_v2_renew_conversation_lock($1, $2, $3::bigint, make_interval(secs => $4))`,
      conversationId,
      ownerId,
      fencingToken,
      seconds,
    );
    return rows.length > 0;
  }

  async release(
    conversationId: string,
    ownerId: string,
    fencingToken: bigint,
  ): Promise<boolean> {
    const rows = await this.prisma.$queryRawUnsafe<unknown[]>(
      `SELECT * FROM wara_v2_release_conversation_lock($1, $2, $3::bigint)`,
      conversationId,
      ownerId,
      fencingToken,
    );
    return rows.length > 0;
  }
}

export class PrismaIngressPort implements IngressPort {
  constructor(private readonly prisma: PrismaClient) {}

  async accept(input: {
    provider: string;
    channelAccountId: string;
    externalMessageId: string;
    conversationId: string;
    payloadHash: string;
  }) {
    const existing = await this.prisma.messageIngress.findUnique({
      where: {
        provider_channelAccountId_externalMessageId: {
          provider: input.provider,
          channelAccountId: input.channelAccountId,
          externalMessageId: input.externalMessageId,
        },
      },
    });
    if (existing) {
      await this.prisma.messageIngressAttempt.create({
        data: {
          id: randomUUID(),
          provider: input.provider,
          channelAccountId: input.channelAccountId,
          externalMessageId: input.externalMessageId,
          payloadHash: input.payloadHash,
          result:
            existing.inboundPayloadHash === input.payloadHash
              ? "duplicate"
              : "duplicate_conflict",
          conversationId: input.conversationId,
          linkedIngressProvider: existing.provider,
          linkedIngressAccount: existing.channelAccountId,
          linkedIngressExtId: existing.externalMessageId,
        },
      });
      if (existing.inboundPayloadHash === input.payloadHash) return "duplicate";
      return "duplicate_conflict";
    }
    try {
      await this.prisma.messageIngress.create({
        data: {
          provider: input.provider,
          channelAccountId: input.channelAccountId,
          externalMessageId: input.externalMessageId,
          conversationId: input.conversationId,
          inboundPayloadHash: input.payloadHash,
          ingressStatus: "accepted",
        },
      });
      await this.prisma.messageIngressAttempt.create({
        data: {
          id: randomUUID(),
          provider: input.provider,
          channelAccountId: input.channelAccountId,
          externalMessageId: input.externalMessageId,
          payloadHash: input.payloadHash,
          result: "accepted",
          conversationId: input.conversationId,
          linkedIngressProvider: input.provider,
          linkedIngressAccount: input.channelAccountId,
          linkedIngressExtId: input.externalMessageId,
        },
      });
      return "accepted";
    } catch {
      const again = await this.prisma.messageIngress.findUnique({
        where: {
          provider_channelAccountId_externalMessageId: {
            provider: input.provider,
            channelAccountId: input.channelAccountId,
            externalMessageId: input.externalMessageId,
          },
        },
      });
      if (!again) throw new Error("ingress_race_failed");
      if (again.inboundPayloadHash === input.payloadHash) return "duplicate";
      return "duplicate_conflict";
    }
  }
}

export class PrismaTurnStore implements TurnStore {
  failNextSave = false;
  constructor(private readonly prisma: PrismaClient) {}

  async findByIdempotencyKey(key: string): Promise<PersistedTurn | null> {
    const t = await this.prisma.turn.findUnique({ where: { idempotencyKey: key } });
    if (!t) return null;
    return {
      id: t.id,
      conversationId: t.conversationId,
      idempotencyKey: t.idempotencyKey!,
      outcome: t.outcome as PersistedTurn["outcome"],
      mode: t.mode,
      fencingToken: t.fencingToken,
      ownerId: t.ownerId,
      decision: t.orchestratorDecision,
      policy: t.policyResult,
      responsePlan: t.responsePlan,
    };
  }

  async beginTurn(turn: {
    id: string;
    conversationId: string;
    idempotencyKey: string;
    ownerId: string;
    fencingToken: bigint;
    mode: import("@wara-v2/contracts").ExecutionMode;
  }): Promise<void> {
    await this.prisma.turn.create({
      data: {
        id: turn.id,
        conversationId: turn.conversationId,
        idempotencyKey: turn.idempotencyKey,
        ownerId: turn.ownerId,
        fencingToken: turn.fencingToken,
        mode: turn.mode,
      },
    });
  }

  async saveTurn(turn: PersistedTurn, traces: TraceEvent[]): Promise<void> {
    if (this.failNextSave) {
      this.failNextSave = false;
      throw new Error("persistence_failure");
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.turn.upsert({
        where: { id: turn.id },
        create: {
          id: turn.id,
          conversationId: turn.conversationId,
          idempotencyKey: turn.idempotencyKey,
          outcome: turn.outcome,
          mode: turn.mode,
          fencingToken: turn.fencingToken,
          ownerId: turn.ownerId,
          orchestratorDecision: (turn.decision ?? {}) as Prisma.InputJsonValue,
          policyResult: (turn.policy ?? {}) as Prisma.InputJsonValue,
          responsePlan: (turn.responsePlan ?? {}) as Prisma.InputJsonValue,
          finishedAt: new Date(),
        },
        update: {
          outcome: turn.outcome,
          orchestratorDecision: (turn.decision ?? {}) as Prisma.InputJsonValue,
          policyResult: (turn.policy ?? {}) as Prisma.InputJsonValue,
          responsePlan: (turn.responsePlan ?? {}) as Prisma.InputJsonValue,
          finishedAt: new Date(),
        },
      });
      for (const tr of traces) {
        await tx.turnTrace.create({
          data: {
            id: randomUUID(),
            turnId: turn.id,
            at: new Date(tr.at),
            event: tr.event,
            meta: this.sanitize(tr.meta ?? {}),
          },
        });
      }
    });
  }

  private sanitize(meta: Record<string, unknown>): Prisma.InputJsonValue {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(meta)) {
      if (
        /password|secret|authorization|api[_-]?key|bearer/i.test(k) ||
        (k.toLowerCase().includes("token") && k !== "fencingToken")
      ) {
        out[k] = "[redacted]";
      } else {
        out[k] = v;
      }
    }
    return out as Prisma.InputJsonValue;
  }
}

export class PrismaOutboxPort implements OutboxPort {
  constructor(private readonly prisma: PrismaClient) {}

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
  }): Promise<void> {
    await this.prisma.deliveryOutbox.create({
      data: {
        id: randomUUID(),
        turnId: input.turnId,
        conversationId: input.conversationId,
        channel: input.channel,
        channelAccountId: input.channelAccountId,
        payload: input.payload as Prisma.InputJsonValue,
        payloadHash: input.payloadHash,
        status: input.status,
        attemptCount: 0,
        maxAttempts: 3,
        idempotencyKey: input.idempotencyKey,
        executionMode: "dry_run",
        suppressReason: input.suppressReason,
        kind: "outbound_message",
      },
    });
  }
}

export class PrismaOperationPort implements OperationPort {
  constructor(private readonly prisma: PrismaClient) {}

  async listActive(conversationId: string): Promise<OperationRecord[]> {
    const rows = await this.prisma.operation.findMany({
      where: {
        conversationId,
        status: {
          notIn: [
            "succeeded",
            "cancelled",
            "expired",
            "permanent_failed",
            "superseded",
          ],
        },
      },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((r) => mapOp(r));
  }

  async get(id: string): Promise<OperationRecord | null> {
    const row = await this.prisma.operation.findUnique({ where: { id } });
    return row ? mapOp(row) : null;
  }
}

function mapOp(row: {
  id: string;
  lineageId: string;
  operationVersion: number;
  type: string;
  conversationId: string;
  customerId: string;
  companyId: string;
  unitId: string | null;
  payload: unknown;
  payloadHash: string;
  payloadSchemaVersion: number;
  status: string;
  requiresConfirmation: boolean;
  confirmationId: string | null;
  idempotencyKey: string;
  attemptCount: number;
  result: unknown;
  error: unknown;
  executionMode: string;
  supersedesId: string | null;
  supersededById: string | null;
  cancelRequestedAt: Date | null;
  queuedAt: Date | null;
  processingAt: Date | null;
  finishedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): OperationRecord {
  return {
    id: row.id,
    lineageId: row.lineageId,
    operationVersion: row.operationVersion,
    type: row.type as OperationRecord["type"],
    conversationId: row.conversationId,
    customerId: row.customerId,
    companyId: row.companyId,
    unitId: row.unitId,
    payload: row.payload,
    payloadHash: row.payloadHash,
    payloadSchemaVersion: row.payloadSchemaVersion,
    status: row.status as OperationRecord["status"],
    requiresConfirmation: row.requiresConfirmation,
    confirmationId: row.confirmationId,
    idempotencyKey: row.idempotencyKey,
    attemptCount: row.attemptCount,
    result: row.result,
    error: row.error,
    executionMode: row.executionMode as OperationRecord["executionMode"],
    supersedesId: row.supersedesId,
    supersededById: row.supersededById,
    cancelRequestedAt: row.cancelRequestedAt,
    queuedAt: row.queuedAt,
    processingAt: row.processingAt,
    finishedAt: row.finishedAt,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
