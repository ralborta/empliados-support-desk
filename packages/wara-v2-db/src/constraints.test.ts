/**
 * Tests de constraints/migración V2 (PostgreSQL local vía with-embedded-pg).
 * No mutaciones externas; dry_run flags intactos.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, before, after } from "node:test";
import { createWaraV2Prisma, V2_DEFAULT_MODE, V2_MUTATIONS_DISABLED } from "./index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function hash(s: string) {
  return createHash("sha256").update(s).digest("hex");
}

describe("@wara-v2/db flags", () => {
  it("mantiene mutaciones desactivadas y dry_run por defecto", () => {
    assert.equal(V2_MUTATIONS_DISABLED, true);
    assert.equal(V2_DEFAULT_MODE, "dry_run");
  });

  it("rechaza reusar DATABASE_URL de V1", () => {
    const shared = "postgresql://shared.example/db";
    const prev = process.env.DATABASE_URL;
    process.env.DATABASE_URL = shared;
    try {
      assert.throws(
        () => createWaraV2Prisma(shared),
        /Refusing to use DATABASE_URL/,
      );
    } finally {
      if (prev === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = prev;
    }
  });
});

describe("@wara-v2/db constraints (embedded PG)", () => {
  const url = process.env.WARA_V2_DATABASE_URL;
  if (!url) {
    it("SKIP: requiere WARA_V2_DATABASE_URL (usar prisma:test:migrate)", () => {
      assert.ok(true);
    });
    return;
  }

  const prisma = createWaraV2Prisma(url);
  let customerId = "";
  let conversationId = "";

  before(async () => {
    const customer = await prisma.customer.create({
      data: { phoneE164: "+5491100000001", displayName: "V2 Constraint Tester" },
    });
    customerId = customer.id;
    const conversation = await prisma.conversation.create({
      data: {
        customerId,
        channel: "simulator",
        channelAccountId: "sim-account-1",
      },
    });
    conversationId = conversation.id;
  });

  after(async () => {
    await prisma.$disconnect();
  });

  it("aplica funciones ConversationLock ADR-040", async () => {
    const rows = await prisma.$queryRawUnsafe<
      { fencing_token: bigint; owner_id: string; lease_expires_at: Date }[]
    >(
      `SELECT * FROM wara_v2_acquire_conversation_lock($1, $2, interval '5 seconds')`,
      conversationId,
      "worker-a",
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].owner_id, "worker-a");
    assert.equal(Number(rows[0].fencing_token), 1);

    const blocked = await prisma.$queryRawUnsafe<unknown[]>(
      `SELECT * FROM wara_v2_acquire_conversation_lock($1, $2, interval '5 seconds')`,
      conversationId,
      "worker-b",
    );
    assert.equal(blocked.length, 0);

    const renewed = await prisma.$queryRawUnsafe<{ lease_expires_at: Date }[]>(
      `SELECT * FROM wara_v2_renew_conversation_lock($1, $2, $3::bigint, interval '5 seconds')`,
      conversationId,
      "worker-a",
      1,
    );
    assert.equal(renewed.length, 1);

    const wrongRenew = await prisma.$queryRawUnsafe<unknown[]>(
      `SELECT * FROM wara_v2_renew_conversation_lock($1, $2, $3::bigint, interval '5 seconds')`,
      conversationId,
      "worker-b",
      1,
    );
    assert.equal(wrongRenew.length, 0);

    const released = await prisma.$queryRawUnsafe<{ fencing_token: bigint }[]>(
      `SELECT * FROM wara_v2_release_conversation_lock($1, $2, $3::bigint)`,
      conversationId,
      "worker-a",
      1,
    );
    assert.equal(released.length, 1);

    const reacquired = await prisma.$queryRawUnsafe<
      { fencing_token: bigint; owner_id: string }[]
    >(
      `SELECT * FROM wara_v2_acquire_conversation_lock($1, $2, interval '30 seconds')`,
      conversationId,
      "worker-b",
    );
    assert.equal(reacquired.length, 1);
    assert.equal(reacquired[0].owner_id, "worker-b");
    assert.equal(Number(reacquired[0].fencing_token), 2);
  });

  it("fencing_token no puede decrementar", async () => {
    await assert.rejects(
      () =>
        prisma.$executeRawUnsafe(
          `UPDATE conversation_locks SET fencing_token = 0 WHERE conversation_id = $1`,
          conversationId,
        ),
      /monotonic/i,
    );
  });

  it("OperationEvent es append-only", async () => {
    const op = await prisma.operation.create({
      data: {
        lineageId: "lin_evt_1",
        operationVersion: 1,
        type: "update_odometer",
        conversationId,
        customerId,
        companyId: "co_1",
        payload: { km: 100 },
        payloadHash: hash("evt1"),
        idempotencyKey: "idem_evt_1",
        executionMode: "dry_run",
      },
    });
    const ev = await prisma.operationEvent.create({
      data: {
        operationId: op.id,
        event: "created",
        toStatus: "draft",
      },
    });
    await assert.rejects(
      () =>
        prisma.operationEvent.update({
          where: { id: ev.id },
          data: { event: "tampered" },
        }),
      /append-only/i,
    );
    await assert.rejects(
      () => prisma.operationEvent.delete({ where: { id: ev.id } }),
      /append-only/i,
    );
  });

  it("MessageIngressAttempt es append-only y canónico protege hash/status", async () => {
    await prisma.messageIngress.create({
      data: {
        provider: "bbc",
        channelAccountId: "acc",
        externalMessageId: "ext-1",
        conversationId,
        inboundPayloadHash: hash("payload-a"),
        ingressStatus: "accepted",
      },
    });
    const attempt = await prisma.messageIngressAttempt.create({
      data: {
        provider: "bbc",
        channelAccountId: "acc",
        externalMessageId: "ext-1",
        payloadHash: hash("payload-a"),
        result: "accepted",
        linkedIngressProvider: "bbc",
        linkedIngressAccount: "acc",
        linkedIngressExtId: "ext-1",
      },
    });
    await assert.rejects(
      () =>
        prisma.messageIngressAttempt.update({
          where: { id: attempt.id },
          data: { reason: "nope" },
        }),
      /append-only/i,
    );
    await assert.rejects(
      () =>
        prisma.messageIngress.update({
          where: {
            provider_channelAccountId_externalMessageId: {
              provider: "bbc",
              channelAccountId: "acc",
              externalMessageId: "ext-1",
            },
          },
          data: { inboundPayloadHash: hash("other") },
        }),
      /immutable/i,
    );
    await assert.rejects(
      () =>
        prisma.messageIngress.update({
          where: {
            provider_channelAccountId_externalMessageId: {
              provider: "bbc",
              channelAccountId: "acc",
              externalMessageId: "ext-1",
            },
          },
          data: { ingressStatus: "duplicate" },
        }),
      /cannot change/i,
    );
  });

  it("UNIQUE(lineage_id, operation_version) y una activa por lineage", async () => {
    await prisma.operation.create({
      data: {
        lineageId: "lin_active",
        operationVersion: 1,
        type: "issue_certificate",
        conversationId,
        customerId,
        companyId: "co_1",
        payload: { unit: "U1" },
        payloadHash: hash("a1"),
        idempotencyKey: "idem_active_1",
        status: "awaiting_confirmation",
        executionMode: "dry_run",
      },
    });
    await assert.rejects(
      () =>
        prisma.operation.create({
          data: {
            lineageId: "lin_active",
            operationVersion: 1,
            type: "issue_certificate",
            conversationId,
            customerId,
            companyId: "co_1",
            payload: { unit: "U1" },
            payloadHash: hash("a1b"),
            idempotencyKey: "idem_active_1b",
            status: "draft",
            executionMode: "dry_run",
          },
        }),
      /Unique constraint/i,
    );
    await assert.rejects(
      () =>
        prisma.operation.create({
          data: {
            lineageId: "lin_active",
            operationVersion: 2,
            type: "issue_certificate",
            conversationId,
            customerId,
            companyId: "co_1",
            payload: { unit: "U1" },
            payloadHash: hash("a2"),
            idempotencyKey: "idem_active_2",
            status: "draft",
            executionMode: "dry_run",
          },
        }),
      /Unique constraint|operations_one_active/i,
    );
  });

  it("supersede exige misma lineage y version = prev+1", async () => {
    const prev = await prisma.operation.create({
      data: {
        lineageId: "lin_super",
        operationVersion: 1,
        type: "create_maintenance",
        conversationId,
        customerId,
        companyId: "co_2",
        payload: { note: "v1" },
        payloadHash: hash("s1"),
        idempotencyKey: "idem_super_1",
        status: "awaiting_confirmation",
        executionMode: "dry_run",
      },
    });
    await prisma.operation.update({
      where: { id: prev.id },
      data: { status: "superseded" },
    });
    await assert.rejects(
      () =>
        prisma.operation.create({
          data: {
            lineageId: "lin_other",
            operationVersion: 2,
            type: "create_maintenance",
            conversationId,
            customerId,
            companyId: "co_2",
            payload: { note: "bad" },
            payloadHash: hash("sbad"),
            idempotencyKey: "idem_super_bad",
            supersedesId: prev.id,
            status: "draft",
            executionMode: "dry_run",
          },
        }),
      /same lineage_id/i,
    );
    await assert.rejects(
      () =>
        prisma.operation.create({
          data: {
            lineageId: "lin_super",
            operationVersion: 3,
            type: "create_maintenance",
            conversationId,
            customerId,
            companyId: "co_2",
            payload: { note: "bad2" },
            payloadHash: hash("sbad2"),
            idempotencyKey: "idem_super_bad2",
            supersedesId: prev.id,
            status: "draft",
            executionMode: "dry_run",
          },
        }),
      /previous\+1/i,
    );
    const next = await prisma.operation.create({
      data: {
        lineageId: "lin_super",
        operationVersion: 2,
        type: "create_maintenance",
        conversationId,
        customerId,
        companyId: "co_2",
        payload: { note: "v2" },
        payloadHash: hash("s2"),
        idempotencyKey: "idem_super_2",
        supersedesId: prev.id,
        status: "draft",
        executionMode: "dry_run",
      },
    });
    assert.equal(next.operationVersion, 2);
    assert.equal(next.supersedesId, prev.id);
  });

  it("DeliveryOutbox soporta unknown_outcome e idempotency_key único", async () => {
    const turn = await prisma.turn.create({
      data: {
        conversationId,
        mode: "dry_run",
        outcome: "ok_simulated",
      },
    });
    await prisma.deliveryOutbox.create({
      data: {
        turnId: turn.id,
        conversationId,
        channel: "simulator",
        channelAccountId: "sim-account-1",
        payload: { text: "hola" },
        payloadHash: hash("hola"),
        status: "unknown_outcome",
        idempotencyKey: "dlv_1",
        executionMode: "dry_run",
        suppressReason: "shadow_no_send",
      },
    });
    await assert.rejects(
      () =>
        prisma.deliveryOutbox.create({
          data: {
            turnId: turn.id,
            conversationId,
            channel: "simulator",
            channelAccountId: "sim-account-1",
            payload: { text: "hola" },
            payloadHash: hash("hola"),
            status: "pending",
            idempotencyKey: "dlv_1",
            executionMode: "dry_run",
          },
        }),
      /Unique constraint/i,
    );
  });

  it("índices/funciones críticos existen en el catálogo", async () => {
    const idx = await prisma.$queryRawUnsafe<{ indexname: string }[]>(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'operations_one_active_per_lineage'`,
    );
    assert.equal(idx.length, 1);
    const fns = await prisma.$queryRawUnsafe<{ proname: string }[]>(
      `SELECT proname FROM pg_proc WHERE proname LIKE 'wara_v2_%' ORDER BY 1`,
    );
    const names = fns.map((f) => f.proname);
    for (const n of [
      "wara_v2_acquire_conversation_lock",
      "wara_v2_renew_conversation_lock",
      "wara_v2_release_conversation_lock",
      "wara_v2_forbid_mutation",
      "wara_v2_protect_ingress_canonical",
      "wara_v2_check_supersede",
      "wara_v2_fencing_monotonic",
    ]) {
      assert.ok(names.includes(n), `missing ${n}`);
    }
  });

  it("schema Prisma y SQL de guards están versionados", () => {
    const schema = readFileSync(
      join(__dirname, "../../../prisma-v2/schema.prisma"),
      "utf8",
    );
    assert.match(schema, /enum OperationStatus/);
    assert.match(schema, /suspended/);
    assert.match(schema, /model ConversationLock/);
    const sql = readFileSync(
      join(__dirname, "../../../prisma-v2/sql/conversation_lock_and_guards.sql"),
      "utf8",
    );
    assert.match(sql, /wara_v2_acquire_conversation_lock/);
  });
});
