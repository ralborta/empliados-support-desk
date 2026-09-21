/**
 * Dispatcher de outbox — claim SKIP LOCKED, pre-HTTP, HTTP simulado, complete.
 * Attempt write-once ya existe (prepare/openRetryAttempt); outcomes vía dominio + eventos.
 */
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@wara-v2/db";
import {
  OperationDomainService,
  PrismaUnitOfWork,
  type OperationDomainEvent,
} from "@wara-v2/domain";
import {
  classifyAttemptResult,
  mayAutoRetry,
  requiresReconcile,
  toDomainEvent,
  type ResultClassification,
} from "../classification.js";
import { backoffMs } from "../idempotency.js";
import { validatePreHttp } from "../prehttp/validate.js";
import {
  postToLocalSimulator,
  type SimulatorClientResult,
} from "../simulator/client.js";
import type { SimScenario } from "../simulator/local-server.js";
import { assertPhase5Guarantees } from "../guarantees.js";
import { openRetryAttempt } from "./prepare.js";

export type DispatchOnceResult = {
  handled: boolean;
  outboxId?: string;
  classification?: ResultClassification;
  reason?: string;
  attemptId?: string;
};

export class OutboxDispatcher {
  private readonly domain: OperationDomainService;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly opts: {
      ownerId: string;
      simulatorUrl: string;
      allowedPorts: ReadonlySet<number>;
      scenario?: SimScenario;
      crashAfterHttp?: boolean;
      failBeforeHttpPersist?: boolean;
    },
  ) {
    assertPhase5Guarantees();
    this.domain = new OperationDomainService(new PrismaUnitOfWork(prisma));
  }

  async dispatchOnce(outboxId?: string): Promise<DispatchOnceResult> {
    const claimed = await this.prisma.$queryRawUnsafe<
      Array<{
        id: string;
        claim_owner_id: string;
        claim_fence: bigint;
        operation_id: string | null;
        idempotency_key: string;
        attempt_count: number;
        max_attempts: number;
        status: string;
        attempt_id: string | null;
        last_classification: string | null;
      }>
    >(
      `SELECT * FROM wara_v2_claim_outbox($1, interval '30 seconds', $2)`,
      this.opts.ownerId,
      outboxId ?? null,
    );

    if (!claimed.length) return { handled: false };
    const row = claimed[0]!;

    if (row.status === "unknown_outcome") {
      if (row.operation_id) {
        await this.applyDomainOutcome(row.operation_id, "unknown_outcome", {
          notes: "claim_expired_without_result",
          existingAttemptId: row.attempt_id,
        });
      }
      return {
        handled: true,
        outboxId: row.id,
        classification: "unknown_outcome",
        reason: "claim_expired_recovery",
        attemptId: row.attempt_id ?? undefined,
      };
    }

    const fence = BigInt(row.claim_fence);

    // Re-adquirir lease solo si está vencida (recuperación post-turno).
    // Si otro owner la tiene vigente, pre-HTTP deniega.
    if (row.operation_id) {
      const op = await this.prisma.operation.findUnique({
        where: { id: row.operation_id },
      });
      if (op) {
        const lock = await this.prisma.conversationLock.findUnique({
          where: { conversationId: op.conversationId },
        });
        const now = Date.now();
        if (
          !lock ||
          !lock.leaseExpiresAt ||
          lock.leaseExpiresAt.getTime() <= now
        ) {
          await this.prisma.$queryRawUnsafe(
            `SELECT * FROM wara_v2_acquire_conversation_lock($1, $2, interval '30 seconds')`,
            op.conversationId,
            this.opts.ownerId,
          );
        }
      }
    }

    // Write-once attempt debe existir antes del HTTP
    const opened = await openRetryAttempt(this.prisma, {
      outboxId: row.id,
      ownerId: this.opts.ownerId,
      lockFencingToken: fence,
    });
    if (!opened.ok) {
      return this.complete(row.id, fence, {
        classification: "denied_pre_http",
        status: "failed",
        error: opened.reason,
        nextAttemptAt: null,
        reconcile: "not_needed",
        http: null,
        operationId: row.operation_id,
        idempotencyKey: row.idempotency_key,
        attemptId: null,
        applyDomain: false,
      });
    }

    const pre = await validatePreHttp(this.prisma, {
      outboxId: row.id,
      ownerId: this.opts.ownerId,
      claimFence: fence,
      simulatorUrl: this.opts.simulatorUrl,
      allowedPorts: this.opts.allowedPorts,
    });

    if (!pre.ok) {
      return this.complete(row.id, fence, {
        classification: "denied_pre_http",
        status:
          mayAutoRetry("denied_pre_http") && opened.attemptNo < row.max_attempts
            ? "pending"
            : "failed",
        error: pre.reason,
        nextAttemptAt:
          mayAutoRetry("denied_pre_http") && opened.attemptNo < row.max_attempts
            ? new Date(Date.now() + backoffMs(opened.attemptNo))
            : null,
        reconcile: "not_needed",
        http: null,
        operationId: row.operation_id,
        idempotencyKey: row.idempotency_key,
        attemptId: opened.attemptId,
        applyDomain: false,
        requeueForRetry:
          mayAutoRetry("denied_pre_http") && opened.attemptNo < row.max_attempts,
      });
    }

    if (this.opts.failBeforeHttpPersist) {
      throw new Error("persistence_failure_before_http");
    }

    const http = await postToLocalSimulator({
      url: this.opts.simulatorUrl,
      allowedPorts: this.opts.allowedPorts,
      idempotencyKey: row.idempotency_key,
      body: {
        operationId: pre.operationId,
        payloadHash: pre.payloadHash,
        version: pre.version,
      },
      scenario: this.opts.scenario,
      timeoutMs: 400,
    });

    if (this.opts.crashAfterHttp) {
      throw new Error("crash_after_http_before_persist");
    }

    const classification = (() => {
      const base = classifyAttemptResult({
        requestLikelySent: http.requestLikelySent,
        httpStatus: http.httpStatus,
        errorCode: http.errorCode,
        bodyOk: http.bodyOk,
        phase: http.phase,
        duplicateIdempotent: http.httpStatus === 409,
      });
      if (this.opts.scenario === "timeout_before_send" && http.errorCode === "TIMEOUT") {
        return "timeout_before_send" as const;
      }
      if (this.opts.scenario === "timeout_after_send" && http.errorCode === "TIMEOUT") {
        return "timeout_after_send" as const;
      }
      if (this.opts.scenario === "reset_after_write") return "unknown_outcome" as const;
      if (this.opts.scenario === "malformed_after_process") {
        return "unknown_outcome" as const;
      }
      return base;
    })();

    const retry =
      mayAutoRetry(classification) && opened.attemptNo < row.max_attempts;
    const needsReconcile = requiresReconcile(classification);

    let status: "delivered" | "failed" | "pending" | "unknown_outcome" = "failed";
    if (classification === "success" || classification === "duplicate_idempotent") {
      status = "delivered";
    } else if (needsReconcile) {
      status = "unknown_outcome";
    } else if (retry) {
      status = "pending";
    }

    return this.complete(row.id, fence, {
      classification,
      status,
      error: http.errorCode,
      nextAttemptAt: retry
        ? new Date(Date.now() + backoffMs(opened.attemptNo))
        : null,
      reconcile: needsReconcile ? "pending" : "not_needed",
      http,
      operationId: row.operation_id,
      idempotencyKey: row.idempotency_key,
      externalId: http.externalId,
      attemptId: opened.attemptId,
      applyDomain: true,
      requeueForRetry: retry,
    });
  }

  private async complete(
    outboxId: string,
    fence: bigint,
    args: {
      classification: ResultClassification;
      status: "delivered" | "failed" | "pending" | "unknown_outcome" | "sending";
      error: string | null;
      nextAttemptAt: Date | null;
      reconcile: "not_needed" | "pending" | "resolved" | "needs_human";
      http: SimulatorClientResult | null;
      operationId: string | null;
      idempotencyKey: string;
      externalId?: string;
      attemptId: string | null;
      applyDomain: boolean;
      requeueForRetry?: boolean;
    },
  ): Promise<DispatchOnceResult> {
    if (args.operationId && args.applyDomain) {
      await this.applyDomainOutcome(args.operationId, args.classification, {
        notes: args.classification,
        existingAttemptId: args.attemptId,
        httpStatus: args.http?.httpStatus ?? null,
        error: args.error,
        reconcile: args.reconcile,
      });
      if (args.requeueForRetry && args.status === "pending") {
        await this.requeueAfterRetryable(args.operationId);
      }
    }

    const completed = await this.prisma.$queryRawUnsafe<unknown[]>(
      `SELECT * FROM wara_v2_complete_outbox_claim(
        $1::text, $2::text, $3::bigint,
        $4::"DeliveryStatus", $5::"ResultClassification",
        $6::text, $7::text, $8::text, $9::timestamptz,
        $10::"ReconciliationStatus"
      )`,
      outboxId,
      this.opts.ownerId,
      fence,
      args.status === "pending" ? "pending" : args.status,
      args.classification,
      args.externalId ?? null,
      args.error,
      args.attemptId,
      args.nextAttemptAt,
      args.reconcile,
    );

    if (!completed.length) {
      return {
        handled: true,
        outboxId,
        classification: args.classification,
        reason: "stale_fence_complete_rejected",
        attemptId: args.attemptId ?? undefined,
      };
    }

    return {
      handled: true,
      outboxId,
      classification: args.classification,
      attemptId: args.attemptId ?? undefined,
    };
  }

  private async requeueAfterRetryable(operationId: string) {
    const op = await this.prisma.operation.findUnique({
      where: { id: operationId },
    });
    if (!op || op.status !== "retryable_failed") return;
    const lock = await this.prisma.conversationLock.findUnique({
      where: { conversationId: op.conversationId },
    });
    if (!lock) return;

    await this.domain.apply({
      commandId: randomUUID(),
      operationId,
      event: "retry_allowed",
      actor: this.opts.ownerId,
      context: { mutationsDisabled: true },
    });
    await this.domain.apply({
      commandId: randomUUID(),
      operationId,
      event: "start_attempt",
      actor: this.opts.ownerId,
      context: {
        mutationsDisabled: true,
        lock: {
          ownerId: lock.ownerId ?? this.opts.ownerId,
          fencingToken: lock.fencingToken,
          leaseExpiresAt: lock.leaseExpiresAt,
        },
        claimedOwnerId: lock.ownerId ?? this.opts.ownerId,
        claimedFencingToken: lock.fencingToken,
      },
    });
  }

  private async applyDomainOutcome(
    operationId: string,
    classification: ResultClassification | "unknown_outcome" | "retryable_failure",
    meta: {
      notes: string;
      existingAttemptId: string | null;
      httpStatus?: number | null;
      error?: string | null;
      reconcile?: string;
    },
  ) {
    const op = await this.prisma.operation.findUnique({
      where: { id: operationId },
    });
    if (!op) return;
    if (
      op.status === "succeeded" ||
      op.status === "permanent_failed" ||
      op.status === "cancelled" ||
      op.status === "expired" ||
      op.status === "superseded"
    ) {
      return;
    }

    if (op.status === "unknown_outcome") {
      await this.prisma.operationEvent.create({
        data: {
          id: randomUUID(),
          operationId,
          fromStatus: op.status,
          toStatus: op.status,
          event: "retry_forbidden_unknown_outcome",
          meta: { classification, notes: meta.notes },
          attemptId: meta.existingAttemptId,
          commandId: randomUUID(),
        },
      });
      return;
    }

    const eventName = toDomainEvent(
      classification === "retryable_failure"
        ? "retryable_failure"
        : (classification as ResultClassification),
    );
    const event: OperationDomainEvent =
      classification === "unknown_outcome"
        ? "ambiguous_result"
        : (["attempt_success", "attempt_permanent_failed", "attempt_retryable_failed",
            "timeout_before_send", "timeout_after_send", "ambiguous_result"].includes(
              eventName,
            )
            ? (eventName as OperationDomainEvent)
            : "ambiguous_result");

    const lock = await this.prisma.conversationLock.findUnique({
      where: { conversationId: op.conversationId },
    });

    try {
      await this.domain.apply({
        commandId: randomUUID(),
        operationId,
        event,
        actor: this.opts.ownerId,
        context: {
          mutationsDisabled: true,
          existingAttemptId: meta.existingAttemptId ?? undefined,
          lock: lock
            ? {
                ownerId: lock.ownerId ?? this.opts.ownerId,
                fencingToken: lock.fencingToken,
                leaseExpiresAt: lock.leaseExpiresAt,
              }
            : null,
          claimedOwnerId: lock?.ownerId ?? this.opts.ownerId,
          claimedFencingToken: lock?.fencingToken,
        },
      });
      // Evento append-only de resultado HTTP (sin mutar OperationAttempt)
      if (meta.existingAttemptId) {
        await this.prisma.operationEvent.create({
          data: {
            id: randomUUID(),
            operationId,
            fromStatus: null,
            toStatus: null,
            event: `attempt_result:${classification}`,
            actor: this.opts.ownerId,
            meta: {
              httpStatus: meta.httpStatus,
              error: meta.error,
              reconcile: meta.reconcile,
              immutableAttemptId: meta.existingAttemptId,
            },
            attemptId: meta.existingAttemptId,
            commandId: randomUUID(),
          },
        });
      }
    } catch {
      await this.prisma.operationEvent.create({
        data: {
          id: randomUUID(),
          operationId,
          fromStatus: op.status,
          toStatus: op.status,
          event: `domain_apply_failed:${event}`,
          meta: { classification, notes: meta.notes },
          attemptId: meta.existingAttemptId,
          commandId: randomUUID(),
        },
      });
    }
  }
}
