/**
 * Fixture helpers for Fase 5 PG integration tests.
 */
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import type { PrismaClient } from "@wara-v2/db";

export function hashPayload(p: unknown): string {
  return createHash("sha256").update(JSON.stringify(p)).digest("hex");
}

export async function seedReadyOperation(
  prisma: PrismaClient,
  opts?: {
    companyId?: string;
    unitId?: string;
    status?: "confirmed" | "queued";
  },
): Promise<{
  customer: { id: string };
  conversation: { id: string };
  message: { id: string };
  op: {
    id: string;
    status: string;
    payloadHash: string;
    operationVersion: number;
  };
  conf: { id: string };
  ownerId: string;
  lock: { fencingToken: bigint; ownerId: string | null };
  payloadHash: string;
}> {
  const companyId = opts?.companyId ?? "co_1";
  const unitId = opts?.unitId ?? "unit_1";
  const customer = await prisma.customer.create({
    data: {
      phoneE164: `+54911${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`,
    },
  });
  const conversation = await prisma.conversation.create({
    data: {
      customerId: customer.id,
      channel: "simulator",
      channelAccountId: "sim",
      activeCompanyId: companyId,
    },
  });
  const message = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      direction: "inbound",
      bodyText: "CONFIRMO",
    },
  });
  const payload = {
    company_id: companyId,
    unit_id: unitId,
    value: 12345,
  };
  const payloadHash = hashPayload(payload);
  const op = await prisma.operation.create({
    data: {
      lineageId: randomUUID(),
      operationVersion: 1,
      type: "update_odometer",
      conversationId: conversation.id,
      customerId: customer.id,
      companyId,
      unitId,
      payload,
      payloadHash,
      idempotencyKey: randomUUID(),
      status: "awaiting_confirmation",
      executionMode: "dry_run",
    },
  });
  const conf = await prisma.operationConfirmation.create({
    data: {
      id: randomUUID(),
      operationId: op.id,
      operationVersion: 1,
      payloadHash,
      confirmationMessageId: message.id,
      actorType: "customer",
      actorId: customer.id,
      confirmedAt: new Date(),
      expiresAt: new Date(Date.now() + 3600_000),
      status: "valid",
    },
  });
  await prisma.operation.update({
    where: { id: op.id },
    data: {
      confirmationId: conf.id,
      status: opts?.status ?? "queued",
      queuedAt: new Date(),
    },
  });

  const ownerId = `worker_${randomUUID().slice(0, 6)}`;
  await prisma.$queryRawUnsafe(
    `SELECT * FROM wara_v2_acquire_conversation_lock($1, $2, interval '60 seconds')`,
    conversation.id,
    ownerId,
  );
  const lock = await prisma.conversationLock.findUniqueOrThrow({
    where: { conversationId: conversation.id },
  });

  return {
    customer,
    conversation,
    message,
    op: await prisma.operation.findUniqueOrThrow({ where: { id: op.id } }),
    conf,
    ownerId,
    lock,
    payloadHash,
  };
}
