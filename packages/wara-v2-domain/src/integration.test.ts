/**
 * Integración dominio + Prisma V2 sobre Postgres embebido descartable.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it, before, after } from "node:test";
import { createWaraV2Prisma, V2_MUTATIONS_DISABLED, V2_DEFAULT_MODE } from "@wara-v2/db";
import {
  OperationDomainService,
  PrismaUnitOfWork,
  hashPayload,
} from "./index.js";

describe("@wara-v2/domain integration", () => {
  const url = process.env.WARA_V2_DATABASE_URL;
  if (!url) {
    it("SKIP: requiere WARA_V2_DATABASE_URL", () => assert.ok(true));
    return;
  }

  const prisma = createWaraV2Prisma(url);
  const uow = new PrismaUnitOfWork(prisma);
  const svc = new OperationDomainService(uow);

  let customerId = "";
  let conversationId = "";
  let messageId = "";

  before(async () => {
    assert.equal(V2_MUTATIONS_DISABLED, true);
    assert.equal(V2_DEFAULT_MODE, "dry_run");
    const customer = await prisma.customer.create({
      data: { phoneE164: "+5491100000099", displayName: "Domain IT" },
    });
    customerId = customer.id;
    const conversation = await prisma.conversation.create({
      data: {
        customerId,
        channel: "simulator",
        channelAccountId: "dom-sim",
      },
    });
    conversationId = conversation.id;
    const message = await prisma.message.create({
      data: {
        conversationId,
        direction: "inbound",
        bodyText: "CONFIRMO",
      },
    });
    messageId = message.id;
  });

  after(async () => {
    await prisma.$disconnect();
  });

  it("persistencia: confirm 1:1 + supersede bidireccional + attempt append-only", async () => {
    const created = await svc.apply({
      commandId: randomUUID(),
      event: "prepare_complete",
      create: {
        type: "update_odometer",
        conversationId,
        customerId,
        companyId: "co_it",
        unitId: "unit_1",
        payload: { km: 42 },
        payloadHash: hashPayload({ km: 42 }),
        idempotencyKey: randomUUID(),
        executionMode: "dry_run",
      },
    });
    assert.equal(created.operation.status, "awaiting_confirmation");

    const confId = randomUUID();
    const confirmed = await svc.apply({
      commandId: randomUUID(),
      event: "confirm_valid",
      operationId: created.operation.id,
      confirmation: {
        id: confId,
        operationId: created.operation.id,
        operationVersion: 1,
        payloadHash: created.operation.payloadHash,
        confirmationMessageId: messageId,
        actorType: "customer",
        actorId: customerId,
        confirmedAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    assert.equal(confirmed.operation.confirmationId, confId);
    const conf = await prisma.operationConfirmation.findUniqueOrThrow({
      where: { id: confId },
    });
    assert.equal(conf.operationId, created.operation.id);

    const superseded = await svc.apply({
      commandId: randomUUID(),
      event: "correct_payload",
      operationId: created.operation.id,
      supersede: {
        newPayload: { km: 43 },
        newPayloadHash: hashPayload({ km: 43 }),
        newIdempotencyKey: randomUUID(),
      },
    });
    assert.equal(superseded.operation.status, "superseded");
    assert.ok(superseded.created);
    assert.equal(superseded.created!.supersedesId, created.operation.id);
    assert.equal(
      superseded.operation.supersededById,
      superseded.created!.id,
    );

    await assert.rejects(
      () =>
        prisma.operation.update({
          where: { id: created.operation.id },
          data: { payloadHash: "tampered" },
        }),
      /immutable/i,
    );

    // Attempt append-only: create then forbid update
    const op2 = superseded.created!;
    await svc.apply({
      commandId: randomUUID(),
      event: "confirm_valid",
      operationId: op2.id,
      confirmation: {
        id: randomUUID(),
        operationId: op2.id,
        operationVersion: 2,
        payloadHash: op2.payloadHash,
        confirmationMessageId: messageId,
        actorType: "customer",
        actorId: customerId,
        confirmedAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    await svc.apply({
      commandId: randomUUID(),
      event: "enqueue_commit",
      operationId: op2.id,
      context: {
        mutationsDisabled: true,
        expectedPayloadHash: op2.payloadHash,
        expectedOperationVersion: 2,
      },
    });
    await svc.apply({
      commandId: randomUUID(),
      event: "start_attempt",
      operationId: op2.id,
      context: {
        lock: {
          ownerId: "worker",
          fencingToken: 1n,
          leaseExpiresAt: new Date(Date.now() + 30_000),
        },
        claimedOwnerId: "worker",
        claimedFencingToken: 1n,
        expectedPayloadHash: op2.payloadHash,
        expectedOperationVersion: 2,
      },
    });
    const done = await svc.apply({
      commandId: randomUUID(),
      event: "attempt_retryable_failed",
      operationId: op2.id,
      context: {
        attempt: {
          requestHash: "req",
          fencingToken: 1n,
          ownerId: "worker",
          outcome: "retryable_failed",
          startedAt: new Date(),
          finishedAt: new Date(),
        },
      },
    });
    assert.equal(done.operation.status, "retryable_failed");
    const attempt = await prisma.operationAttempt.findFirstOrThrow({
      where: { operationId: op2.id },
    });
    await assert.rejects(
      () =>
        prisma.operationAttempt.update({
          where: { id: attempt.id },
          data: { outcome: "confirmed_success" },
        }),
      /append-only/i,
    );
  });

  it("migrate status incluye domain_invariants", async () => {
    const rows = await prisma.$queryRawUnsafe<{ migration_name: string }[]>(
      `SELECT migration_name FROM _prisma_migrations ORDER BY finished_at`,
    );
    const names = rows.map((r) => r.migration_name);
    assert.ok(names.includes("20260811170000_init_v2"));
    assert.ok(names.includes("20260811183000_domain_invariants"));
  });
});
