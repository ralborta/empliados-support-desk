/**
 * Reconciliador — solo lectura remota + transiciones de dominio.
 * Nunca reenvía desde unknown_outcome.
 */
import { randomUUID } from "node:crypto";
import type { PrismaClient, Prisma } from "@wara-v2/db";
import { reconcileLocalSimulator } from "../simulator/client.js";

export type ReconcileResult = {
  operationId: string;
  remote: "applied" | "absent" | "ambiguous";
  toStatus?: string;
};

export class EffectReconciler {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly opts: {
      origin: string;
      allowedPorts: ReadonlySet<number>;
      ownerId: string;
    },
  ) {}

  async reconcileOperation(operationId: string): Promise<ReconcileResult> {
    const op = await this.prisma.operation.findUnique({
      where: { id: operationId },
    });
    if (!op) throw new Error("operation_missing");
    if (op.status !== "unknown_outcome" && op.status !== "reconciling") {
      throw new Error(`cannot_reconcile_from_${op.status}`);
    }

    // Enter reconciling
    if (op.status === "unknown_outcome") {
      await this.prisma.operation.updateMany({
        where: { id: operationId, status: "unknown_outcome" },
        data: { status: "reconciling" },
      });
      await this.prisma.operationEvent.create({
        data: {
          id: randomUUID(),
          operationId,
          fromStatus: "unknown_outcome",
          toStatus: "reconciling",
          event: "start_reconcile",
          actor: this.opts.ownerId,
          commandId: randomUUID(),
        },
      });
    }

    const outbox = await this.prisma.deliveryOutbox.findFirst({
      where: { operationId, kind: "external_effect" },
      orderBy: { createdAt: "desc" },
    });
    if (!outbox) {
      return this.finishAmbiguous(operationId, "outbox_missing");
    }

    const remote = await reconcileLocalSimulator({
      origin: this.opts.origin,
      allowedPorts: this.opts.allowedPorts,
      idempotencyKey: outbox.idempotencyKey,
    });

    if (remote === "applied") {
      await this.prisma.operation.updateMany({
        where: { id: operationId, status: "reconciling" },
        data: { status: "succeeded", finishedAt: new Date() },
      });
      await this.prisma.operationEvent.create({
        data: {
          id: randomUUID(),
          operationId,
          fromStatus: "reconciling",
          toStatus: "succeeded",
          event: "reconcile_confirmed_success",
          actor: this.opts.ownerId,
          meta: { remote: "applied" } as Prisma.InputJsonValue,
          commandId: randomUUID(),
        },
      });
      await this.prisma.deliveryOutbox.update({
        where: { id: outbox.id },
        data: {
          status: "delivered",
          reconcileStatus: "resolved",
          lastClassification: "success",
        },
      });
      return { operationId, remote, toStatus: "succeeded" };
    }

    if (remote === "absent") {
      const toStatus = op.cancelRequestedAt ? "cancelled" : "retryable_failed";
      await this.prisma.operation.updateMany({
        where: { id: operationId, status: "reconciling" },
        data: {
          status: toStatus,
          finishedAt: toStatus === "cancelled" ? new Date() : op.finishedAt,
        },
      });
      await this.prisma.operationEvent.create({
        data: {
          id: randomUUID(),
          operationId,
          fromStatus: "reconciling",
          toStatus,
          event: "reconcile_confirmed_absent",
          actor: this.opts.ownerId,
          meta: { remote: "absent" } as Prisma.InputJsonValue,
          commandId: randomUUID(),
        },
      });
      await this.prisma.deliveryOutbox.update({
        where: { id: outbox.id },
        data: {
          status: "failed",
          reconcileStatus: "resolved",
          lastClassification: "timeout_before_send",
        },
      });
      return { operationId, remote, toStatus };
    }

    return this.finishAmbiguous(operationId, "still_ambiguous");
  }

  private async finishAmbiguous(operationId: string, note: string) {
    await this.prisma.operation.updateMany({
      where: { id: operationId, status: "reconciling" },
      data: { status: "unknown_outcome" },
    });
    await this.prisma.operationEvent.create({
      data: {
        id: randomUUID(),
        operationId,
        fromStatus: "reconciling",
        toStatus: "unknown_outcome",
        event: "reconcile_ambiguous",
        actor: this.opts.ownerId,
        meta: { note, needs_human: true } as Prisma.InputJsonValue,
        commandId: randomUUID(),
      },
    });
    return {
      operationId,
      remote: "ambiguous" as const,
      toStatus: "unknown_outcome",
    };
  }
}
