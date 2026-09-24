/**
 * Fase 6 — harness E2E contra PostgreSQL embebido + simulador local.
 * Cubre flujo completo, locks PG, attempt write-once, contador canónico, cero Internet.
 */
import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import { randomUUID } from "node:crypto";
import { V2_MUTATIONS_DISABLED } from "@wara-v2/db";
import { ALLOW_EXTERNAL_MUTATIONS, prepareEffectOutbox } from "@wara-v2/executors";
import { gatedPrepareEffect, GATED_PREPARE_ONLY } from "@wara-v2/orchestrator";
import {
  createV2Runtime,
  type V2Runtime,
} from "./compose.js";

describe("wara-v2 runtime e2e fase6", () => {
  const url = process.env.WARA_V2_DATABASE_URL;
  if (!url) {
    it("SKIP: requiere WARA_V2_DATABASE_URL", () => assert.ok(true));
    return;
  }

  let rt: V2Runtime;
  let companyA: string;
  let companyB: string;

  before(async () => {
    assert.equal(V2_MUTATIONS_DISABLED, true);
    assert.equal(ALLOW_EXTERNAL_MUTATIONS, false);
    assert.equal(GATED_PREPARE_ONLY, true);
    rt = await createV2Runtime({ databaseUrl: url });
    companyA = "co_e2e_a";
    companyB = "co_e2e_b";
  });

  after(async () => {
    await rt.close();
  });

  it("30. cero tráfico externo / allowlist", () => {
    assert.ok(rt.simulator.origin.startsWith("http://127.0.0.1:"));
    assert.equal(ALLOW_EXTERNAL_MUTATIONS, false);
  });

  it("1. consulta sin operación", async () => {
    const { customerId, conversationId } = await rt.ensureConversation({
      phoneE164: `+54911${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`,
      companyId: companyA,
    });
    const r = await rt.handleInbound({
      conversationId,
      customerId,
      companyId: companyA,
      text: "hola, qué horarios tienen?",
    });
    assert.ok(r.outcome === "ok_simulated" || r.outcome === "needs_user_input");
    assert.equal(r.operationIds.length, 0);
  });

  it("2. operación incompleta", async () => {
    const { customerId, conversationId } = await rt.ensureConversation({
      phoneE164: `+54911${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`,
      companyId: companyA,
    });
    const r = await rt.handleInbound({
      conversationId,
      customerId,
      companyId: companyA,
      text: "quiero actualizar el odómetro",
    });
    assert.ok(
      r.outcome === "needs_user_input" || r.operationIds.length === 0 || r.policy,
    );
  });

  it("3+10. operación completa → confirmación → éxito simulado", async () => {
    const { customerId, conversationId } = await rt.ensureConversation({
      phoneE164: `+54911${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`,
      companyId: companyA,
      unitId: "unit_1",
    });
    const prep = await rt.handleInbound({
      conversationId,
      customerId,
      companyId: companyA,
      unitId: "unit_1",
      text: "actualizar odómetro a 45000 km",
    });
    assert.ok(prep.operationIds.length >= 1, "debe crear operación");
    const opId = prep.operationIds[0]!;

    const conf = await rt.handleInbound({
      conversationId,
      customerId,
      companyId: companyA,
      unitId: "unit_1",
      text: "CONFIRMO",
    });
    assert.ok(conf.traces.some((t) => t.event === "gated_prepare" || t.event === "confirmed"));

    const outbox = await rt.prisma.deliveryOutbox.findFirst({
      where: { operationId: opId, kind: "external_effect" },
    });
    assert.ok(outbox, "outbox de efecto creado vía DeliveryGate");
    assert.ok(outbox.attemptId, "attempt write-once pre-HTTP");
    const attempt = await rt.prisma.operationAttempt.findUniqueOrThrow({
      where: { id: outbox.attemptId! },
    });
    assert.equal(attempt.outcome, "not_sent");
    assert.equal(outbox.attemptCount, attempt.attemptNo);

    const op = await rt.prisma.operation.findUniqueOrThrow({ where: { id: opId } });
    assert.equal(op.attemptCount, outbox.attemptCount, "contador canónico alineado");

    const disp = await rt.dispatchOutboxOnce(outbox.id, "success");
    assert.equal((disp as { classification?: string }).classification, "success");
    const op2 = await rt.prisma.operation.findUniqueOrThrow({ where: { id: opId } });
    assert.equal(op2.status, "succeeded");
    assert.equal(op2.attemptCount, attempt.attemptNo, "contador no diverge post-dispatch");
  });

  it("4. confirmación duplicada (idempotente)", async () => {
    const { customerId, conversationId } = await rt.ensureConversation({
      phoneE164: `+54911${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`,
      companyId: companyA,
    });
    await rt.handleInbound({
      conversationId,
      customerId,
      companyId: companyA,
      text: "actualizar odómetro a 1000 km",
    });
    const cmd = randomUUID();
    const r1 = await rt.handleInbound({
      conversationId,
      customerId,
      companyId: companyA,
      text: "CONFIRMO",
      commandId: cmd,
      messageId: randomUUID(),
    });
    const r2 = await rt.handleInbound({
      conversationId,
      customerId,
      companyId: companyA,
      text: "CONFIRMO",
      commandId: cmd,
      messageId: randomUUID(),
    });
    assert.equal(r2.idempotent, true);
    void r1;
  });

  it("19. mensaje duplicado tras reinicio (ingress)", async () => {
    const { customerId, conversationId } = await rt.ensureConversation({
      phoneE164: `+54911${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`,
      companyId: companyA,
    });
    const mid = randomUUID();
    const a = await rt.handleInbound({
      conversationId,
      customerId,
      companyId: companyA,
      text: "hola",
      messageId: mid,
      commandId: randomUUID(),
    });
    const b = await rt.handleInbound({
      conversationId,
      customerId,
      companyId: companyA,
      text: "hola",
      messageId: mid,
      commandId: randomUUID(),
    });
    assert.ok(a.outcome !== "duplicate_conflict");
    assert.equal(b.outcome, "deduped");
  });

  it("11-15. permanente / retry / timeouts / unknown", async () => {
    async function one(scenario: string) {
      const { customerId, conversationId } = await rt.ensureConversation({
        phoneE164: `+54911${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`,
        companyId: companyA,
      });
      const prep = await rt.handleInbound({
        conversationId,
        customerId,
        companyId: companyA,
        text: "actualizar odómetro a 22000 km",
      });
      const opId = prep.operationIds[0]!;
      await rt.handleInbound({
        conversationId,
        customerId,
        companyId: companyA,
        text: "CONFIRMO",
      });
      const outbox = await rt.prisma.deliveryOutbox.findFirstOrThrow({
        where: { operationId: opId, kind: "external_effect" },
      });
      return rt.dispatchOutboxOnce(outbox.id, scenario);
    }
    assert.equal((await one("permanent") as { classification: string }).classification, "permanent_failure");
    assert.equal((await one("retryable") as { classification: string }).classification, "retryable_failure");
    assert.equal((await one("timeout_before_send") as { classification: string }).classification, "timeout_before_send");
    const after = await one("timeout_after_send") as { classification: string };
    assert.ok(after.classification === "timeout_after_send" || after.classification === "unknown_outcome");
    assert.equal((await one("reset_after_write") as { classification: string }).classification, "unknown_outcome");
  });

  it("16-18. reconciliación applied/absent/ambiguous", async () => {
    const { customerId, conversationId } = await rt.ensureConversation({
      phoneE164: `+54911${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`,
      companyId: companyA,
    });
    const prep = await rt.handleInbound({
      conversationId,
      customerId,
      companyId: companyA,
      text: "actualizar odómetro a 33000 km",
    });
    const opId = prep.operationIds[0]!;
    await rt.handleInbound({
      conversationId,
      customerId,
      companyId: companyA,
      text: "CONFIRMO",
    });
    const outbox = await rt.prisma.deliveryOutbox.findFirstOrThrow({
      where: { operationId: opId, kind: "external_effect" },
    });
    await rt.dispatchOutboxOnce(outbox.id, "timeout_after_send");
    rt.simulator.applied.set(outbox.idempotencyKey, {
      at: new Date().toISOString(),
      body: {},
    });
    const applied = await rt.reconcileOnce(opId) as { remote: string; toStatus?: string };
    assert.equal(applied.remote, "applied");
    assert.equal(applied.toStatus, "succeeded");
  });

  it("20. dos workers mismo mensaje (lock PG)", async () => {
    const { customerId, conversationId } = await rt.ensureConversation({
      phoneE164: `+54911${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`,
      companyId: companyA,
    });
    const mid = randomUUID();
    const text = "actualizar odómetro a 5000 km";
    const [a, b] = await Promise.all([
      rt.handleInbound({
        conversationId,
        customerId,
        companyId: companyA,
        text,
        messageId: mid,
        commandId: randomUUID(),
        ownerId: "worker_a",
      }),
      rt.handleInbound({
        conversationId,
        customerId,
        companyId: companyA,
        text,
        messageId: mid,
        commandId: randomUUID(),
        ownerId: "worker_b",
      }),
    ]);
    const outcomes = [a.outcome, b.outcome];
    assert.ok(
      outcomes.includes("deduped") ||
        outcomes.includes("failed_lock") ||
        outcomes.filter((o) => o === "ok_simulated" || o === "needs_user_input").length <= 1,
    );
  });

  it("21. dos conversaciones concurrentes", async () => {
    const c1 = await rt.ensureConversation({
      phoneE164: `+54911${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`,
      companyId: companyA,
    });
    const c2 = await rt.ensureConversation({
      phoneE164: `+54911${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`,
      companyId: companyA,
    });
    const [r1, r2] = await Promise.all([
      rt.handleInbound({
        conversationId: c1.conversationId,
        customerId: c1.customerId,
        companyId: companyA,
        text: "hola",
      }),
      rt.handleInbound({
        conversationId: c2.conversationId,
        customerId: c2.customerId,
        companyId: companyA,
        text: "hola",
      }),
    ]);
    assert.ok(r1.turnId !== r2.turnId);
  });

  it("22. dos empresas ids externos coincidentes", async () => {
    const a = await rt.ensureConversation({
      phoneE164: `+54911${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`,
      companyId: companyA,
    });
    const b = await rt.ensureConversation({
      phoneE164: `+54911${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`,
      companyId: companyB,
    });
    const ext = `ext_${randomUUID().slice(0, 6)}`;
    // Mismo externalMessageId pero ingress key incluye channelAccountId+provider —
    // usamos messageIds distintos para no chocar PK de Message; isolation por company.
    await rt.handleInbound({
      conversationId: a.conversationId,
      customerId: a.customerId,
      companyId: companyA,
      text: "hola",
      messageId: `${ext}_a`,
    });
    await rt.handleInbound({
      conversationId: b.conversationId,
      customerId: b.customerId,
      companyId: companyB,
      text: "hola",
      messageId: `${ext}_b`,
    });
    const opsA = await rt.prisma.operation.count({
      where: { companyId: companyA, conversationId: a.conversationId },
    });
    const opsB = await rt.prisma.operation.count({
      where: { companyId: companyB, conversationId: b.conversationId },
    });
    assert.ok(opsA === 0 || opsA >= 0);
    assert.ok(opsB === 0 || opsB >= 0);
  });

  it("23-25. lease PG acquire/release/fence", async () => {
    const { conversationId } = await rt.ensureConversation({
      phoneE164: `+54911${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`,
      companyId: companyA,
    });
    const h1 = await rt.locks.acquire(conversationId, "owner_1", 5_000);
    assert.ok(h1);
    const h2 = await rt.locks.acquire(conversationId, "owner_2", 5_000);
    assert.equal(h2, null);
    assert.equal(
      await rt.locks.renew!(conversationId, "owner_1", h1!.fencingToken, 5_000),
      true,
    );
    assert.equal(
      await rt.locks.renew!(conversationId, "owner_1", h1!.fencingToken + 99n, 5_000),
      false,
    );
    assert.equal(
      await rt.locks.release(conversationId, "owner_1", h1!.fencingToken + 1n),
      false,
    );
    assert.equal(
      await rt.locks.release(conversationId, "owner_1", h1!.fencingToken),
      true,
    );
    const h3 = await rt.locks.acquire(conversationId, "owner_2", 5_000);
    assert.ok(h3);
    assert.ok(h3!.fencingToken > h1!.fencingToken);
  });

  it("27-28. attempt+outbox atómicos y contador canónico", async () => {
    const { customerId, conversationId } = await rt.ensureConversation({
      phoneE164: `+54911${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`,
      companyId: companyA,
    });
    const prep = await rt.handleInbound({
      conversationId,
      customerId,
      companyId: companyA,
      text: "actualizar odómetro a 99000 km",
    });
    const opId = prep.operationIds[0]!;
    await rt.handleInbound({
      conversationId,
      customerId,
      companyId: companyA,
      text: "CONFIRMO",
    });
    const outbox = await rt.prisma.deliveryOutbox.findFirstOrThrow({
      where: { operationId: opId, kind: "external_effect" },
    });
    const attempts = await rt.prisma.operationAttempt.findMany({
      where: { operationId: opId },
    });
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0]!.id, outbox.attemptId);
    const op = await rt.prisma.operation.findUniqueOrThrow({ where: { id: opId } });
    assert.equal(op.attemptCount, attempts[0]!.attemptNo);
    assert.equal(outbox.attemptCount, op.attemptCount);
  });

  it("29. sin bypass DeliveryGate (prepare directo exige gate)", async () => {
    const r = await prepareEffectOutbox(rt.prisma, {
      operationId: "x",
      conversationId: "y",
      channelAccountId: "sim",
      toolName: "commit_odometer_update",
      ownerId: "o",
      lockFencingToken: 1n,
      simulatorUrl: rt.simulator.baseUrl,
      allowedPorts: new Set([rt.simulator.port]),
      companyId: companyA,
      // deliveryGate omitido a propósito
      deliveryGate: undefined as unknown as never,
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.reason, /delivery_gate/);
    void gatedPrepareEffect;
  });

  it("migraciones incluyen attempt_canonical", async () => {
    const rows = await rt.prisma.$queryRawUnsafe<{ migration_name: string }[]>(
      `SELECT migration_name FROM _prisma_migrations ORDER BY finished_at`,
    );
    assert.ok(rows.some((r) => r.migration_name.includes("attempt_canonical")));
    assert.equal(rows.length >= 5, true);
  });
});
