/**
 * Dispatcher de outbox — claim SKIP LOCKED, pre-HTTP, HTTP simulado, complete.
 * Transiciones de operación vía OperationDomainService.
 */
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@wara-v2/db";
import {
  OperationDomainService,
  PrismaUnitOfWork,
  type OperationDomainEvent,
  type AttemptOutcome,
} from "@wara-v2/domain";
import {
  classifyAttemptResult,
  mayAutoRetry,
  requiresReconcile,
  toAttemptOutcome,
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

export type DispatchOnceResult = {
  handled: boolean;
  outboxId?: string;
  classification?: ResultClassification;
  reason?: string;
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
      /** Hook: crash after HTTP before persist */
      crashAfterHttp?: boolean;
      /** Hook: skip HTTP (simulate persistence failure before send) */
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
        last_classification: string | null;
      }>
    >(
      `SELECT * FROM wara_v2_claim_outbox($1, interval '30 seconds', $2)`,
      this.opts.ownerId,
      outboxId ?? null,
    );

    if (!claimed.length) return { handled: false };
    const row = claimed[0]!;

    // Claim vencido sin resultado → ya marcado unknown_outcome por SQL
    if (row.status === "unknown_outcome") {
      if (row.operation_id) {
        await this.applyDomainOutcome(row.operation_id, "unknown_outcome", {
          httpStatus: null,
          outcome: "unknown_outcome",
          notes: "claim_expired_without_result",
          fencingToken: BigInt(row.claim_fence),
        });
      }
      return {
        handled: true,
        outboxId: row.id,
        classification: "unknown_outcome",
        reason: "claim_expired_recovery",
      };
    }

    const fence = BigInt(row.claim_fence);
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
          mayAutoRetry("denied_pre_http") && row.attempt_count < row.max_attempts
            ? "pending"
            : "failed",
        error: pre.reason,
        nextAttemptAt:
          mayAutoRetry("denied_pre_http") && row.attempt_count < row.max_attempts
            ? new Date(Date.now() + backoffMs(row.attempt_count))
            : null,
        reconcile: "not_needed",
        http: null,
        operationId: row.operation_id,
        idempotencyKey: row.idempotency_key,
        applyDomain: false,
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
      if (this.opts.scenario === "reset_after_write") {
        return "unknown_outcome" as const;
      }
      if (this.opts.scenario === "malformed_after_process") {
        return "unknown_outcome" as const;
      }
      return base;
    })();

    return this.finishWithClassification(row, fence, classification, http);
  }

  private async finishWithClassification(
    row: {
      id: string;
      operation_id: string | null;
      idempotency_key: string;
      attempt_count: number;
      max_attempts: number;
    },
    fence: bigint,
    classification: ResultClassification,
    http: SimulatorClientResult,
  ): Promise<DispatchOnceResult> {
    const retry =
      mayAutoRetry(classification) && row.attempt_count < row.max_attempts;
    const needsReconcile = requiresReconcile(classification);

    let status: "delivered" | "failed" | "pending" | "unknown_outcome" =
      "failed";
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
        ? new Date(Date.now() + backoffMs(row.attempt_count))
        : null,
      reconcile: needsReconcile ? "pending" : "not_needed",
      http,
      operationId: row.operation_id,
      idempotencyKey: row.idempotency_key,
      externalId: http.externalId,
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
      applyDomain: boolean;
      requeueForRetry?: boolean;
    },
  ): Promise<DispatchOnceResult> {
    if (args.operationId && args.applyDomain) {
      await this.applyDomainOutcome(args.operationId, args.classification, {
        httpStatus: args.http?.httpStatus ?? null,
        outcome: toAttemptOutcome(args.classification),
        notes: args.classification,
        fencingToken: fence,
        idempotencyKey: args.idempotencyKey,
        externalId: args.externalId,
        error: args.error,
        reconcile: args.reconcile,
      });

      // Reintento: retryable_failed → queued → processing (dominio)
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
      null,
      args.nextAttemptAt,
      args.reconcile,
    );

    if (!completed.length) {
      return {
        handled: true,
        outboxId,
        classification: args.classification,
        reason: "stale_fence_complete_rejected",
      };
    }

    return {
      handled: true,
      outboxId,
      classification: args.classification,
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
      httpStatus: number | null;
      outcome: string;
      notes: string;
      fencingToken: bigint;
      idempotencyKey?: string;
      externalId?: string;
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
          meta: {
            classification,
            notes: meta.notes,
          },
          commandId: randomUUID(),
        },
      });
      return;
    }

    const eventName = toDomainEvent(
      classification === "retryable_failure"
        ? "retryable_failure"
        : (classification as ResultClassification),
    ) as OperationDomainEvent;

    // Map unknown_outcome classification to ambiguous_result event
    const event: OperationDomainEvent =
      classification === "unknown_outcome"
        ? "ambiguous_result"
        : eventName === "ambiguous_result" ||
            eventName === "attempt_success" ||
            eventName === "attempt_permanent_failed" ||
            eventName === "attempt_retryable_failed" ||
            eventName === "timeout_before_send" ||
            eventName === "timeout_after_send"
          ? eventName
          : "ambiguous_result";

    if (op.status !== "processing" && op.status !== "retryable_failed") {
      // Recovery path: force unknown if still processing-like
      if (op.status === "reconciling") return;
    }

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
          lock: lock
            ? {
                ownerId: lock.ownerId ?? this.opts.ownerId,
                fencingToken: lock.fencingToken,
                leaseExpiresAt: lock.leaseExpiresAt,
              }
            : null,
          claimedOwnerId: lock?.ownerId ?? this.opts.ownerId,
          claimedFencingToken: lock?.fencingToken,
          attempt: {
            id: randomUUID(),
            requestHash: meta.idempotencyKey ?? operationId,
            fencingToken: meta.fencingToken,
            ownerId: this.opts.ownerId,
            outcome: meta.outcome as AttemptOutcome,
            startedAt: new Date(),
            finishedAt: new Date(),
            externalIdempotencyKey: meta.idempotencyKey ?? null,
            externalReference: meta.externalId ?? null,
            httpStatus: meta.httpStatus,
            error: meta.error ? { code: meta.error } : null,
            reconciliationStatus:
              meta.reconcile === "pending"
                ? "pending"
                : meta.reconcile === "needs_human"
                  ? "needs_human"
                  : "not_needed",
            reconciliationNotes: meta.notes,
          },
        },
      });
    } catch {
      // Fallback append-only si la transición de dominio no aplica (p.ej. fence)
      await this.prisma.operationEvent.create({
        data: {
          id: randomUUID(),
          operationId,
          fromStatus: op.status,
          toStatus: op.status,
          event: `domain_apply_failed:${event}`,
          meta: { classification, notes: meta.notes },
          commandId: randomUUID(),
        },
      });
    }
  }
}
