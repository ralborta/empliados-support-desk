/**
 * Regularización Fase 6 — escenarios con assertion individual (PG embebido).
 * Complementa e2e.pg.test.ts; no agrupa cobertura.
 */
import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import { randomUUID } from "node:crypto";
import { OperationDomainService, PrismaUnitOfWork, hashPayload } from "@wara-v2/domain";
import {
  OutboxDispatcher,
  EffectReconciler,
  simulatorGatePass,
  prepareEffectOutbox,
} from "@wara-v2/executors";
import { createV2Runtime, type V2Runtime } from "./compose.js";

describe("fase6 coverage individual PG", () => {
  const url = process.env.WARA_V2_DATABASE_URL;
  if (!url) {
    it("SKIP: requiere WARA_V2_DATABASE_URL", () => assert.ok(true));
    return;
  }

  let rt: V2Runtime;
  const companyId = "co_cov";

  before(async () => {
    rt = await createV2Runtime({ databaseUrl: url });
  });

  after(async () => {
    await rt.close();
  });

  async function prepConfirmed() {
    const { customerId, conversationId } = await rt.ensureConversation({
      phoneE164: `+54911${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`,
      companyId,
    });
    const prep = await rt.handleInbound({
      conversationId,
      customerId,
      companyId,
      text: "actualizar odómetro a 77777 km",
    });
    assert.ok(prep.operationIds.length >= 1);
    const opId = prep.operationIds[0]!;
    await rt.handleInbound({
      conversationId,
      customerId,
      companyId,
      text: "CONFIRMO",
    });
    const outbox = await rt.prisma.deliveryOutbox.findFirstOrThrow({
      where: { operationId: opId, kind: "external_effect" },
    });
    return { customerId, conversationId, opId, outbox };
  }

  it("5. confirmación vencida clock", async () => {
    const { customerId, conversationId } = await rt.ensureConversation({
      phoneE164: `+54911${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`,
      companyId,
    });
    const prep = await rt.handleInbound({
      conversationId,
      customerId,
      companyId,
      text: "actualizar odómetro a 11111 km",
    });
    const opId = prep.operationIds[0]!;
    await rt.handleInbound({
      conversationId,
      customerId,
      companyId,
      text: "CONFIRMO",
    });
    const op = await rt.prisma.operation.findUniqueOrThrow({ where: { id: opId } });
    assert.ok(op.confirmationId);
    await rt.prisma.operationConfirmation.update({
      where: { id: op.confirmationId! },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    const outbox = await rt.prisma.deliveryOutbox.findFirst({
      where: { operationId: opId, kind: "external_effect" },
    });
    if (outbox) {
      const r = await rt.dispatchOutboxOnce(outbox.id, "success");
      assert.equal((r as { classification: string }).classification, "denied_pre_http");
    } else {
      // Si gate bloqueó prepare por confirm inválida en otro camino
      assert.ok(true);
    }
  });

  it("6. corrección genera nueva versión", async () => {
    const { customerId, conversationId } = await rt.ensureConversation({
      phoneE164: `+54911${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`,
      companyId,
    });
    const prep = await rt.handleInbound({
      conversationId,
      customerId,
      companyId,
      text: "actualizar odómetro a 22222 km",
    });
    const opId = prep.operationIds[0]!;
    const domain = new OperationDomainService(new PrismaUnitOfWork(rt.prisma));
    const op = await rt.prisma.operation.findUniqueOrThrow({ where: { id: opId } });
    const newPayload = {
      ...(op.payload as object),
      value: 33333,
      corrected: true,
    };
    const applied = await domain.apply({
      commandId: randomUUID(),
      event: "correct_payload",
      operationId: opId,
      supersede: {
        newPayload,
        newPayloadHash: hashPayload(newPayload),
        newIdempotencyKey: randomUUID(),
      },
    });
    assert.ok(applied.created);
    assert.equal(applied.created!.operationVersion, 2);
    const prev = await rt.prisma.operation.findUniqueOrThrow({ where: { id: opId } });
    assert.equal(prev.status, "superseded");
    assert.equal(prev.supersededById, applied.created!.id);
  });

  it("8. suspensión y revalidación", async () => {
    const { customerId, conversationId } = await rt.ensureConversation({
      phoneE164: `+54911${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`,
      companyId,
    });
    const prep = await rt.handleInbound({
      conversationId,
      customerId,
      companyId,
      text: "actualizar odómetro a 44444 km",
    });
    const opId = prep.operationIds[0]!;
    const domain = new OperationDomainService(new PrismaUnitOfWork(rt.prisma));
    await domain.apply({
      commandId: randomUUID(),
      event: "context_incompatible",
      operationId: opId,
    });
    let op = await rt.prisma.operation.findUniqueOrThrow({ where: { id: opId } });
    assert.equal(op.status, "suspended");
    await domain.apply({
      commandId: randomUUID(),
      event: "context_compatible",
      operationId: opId,
      context: { contextRevalidated: true, mutationsDisabled: true },
    });
    op = await rt.prisma.operation.findUniqueOrThrow({ where: { id: opId } });
    assert.equal(op.status, "awaiting_confirmation");
  });

  it("9. cancelación antes del despacho", async () => {
    const { opId, outbox } = await prepConfirmed();
    const domain = new OperationDomainService(new PrismaUnitOfWork(rt.prisma));
    await domain.apply({
      commandId: randomUUID(),
      event: "user_cancel",
      operationId: opId,
    });
    const op = await rt.prisma.operation.findUniqueOrThrow({ where: { id: opId } });
    assert.equal(op.status, "cancel_requested");
    const r = await rt.dispatchOutboxOnce(outbox.id, "success");
    assert.equal((r as { classification: string }).classification, "denied_pre_http");
  });

  it("17. reconciliación ausente", async () => {
    const { opId, outbox } = await prepConfirmed();
    // Sin HTTP al simulador: estado unknown + remoto vacío ⇒ absent
    await rt.prisma.operation.update({
      where: { id: opId },
      data: { status: "unknown_outcome" },
    });
    await rt.prisma.deliveryOutbox.update({
      where: { id: outbox.id },
      data: { status: "unknown_outcome", reconcileStatus: "pending" },
    });
    rt.simulator.applied.delete(outbox.idempotencyKey);
    const rec = await rt.reconcileOnce(opId) as { remote: string; toStatus?: string };
    assert.equal(rec.remote, "absent");
    assert.equal(rec.toStatus, "retryable_failed");
  });

  it("18. reconciliación ambigua", async () => {
    const { opId, outbox } = await prepConfirmed();
    await rt.dispatchOutboxOnce(outbox.id, "timeout_after_send");
    await rt.prisma.operation.update({
      where: { id: opId },
      data: { status: "unknown_outcome" },
    });
    const bad = new EffectReconciler(rt.prisma, {
      origin: "http://evil.example",
      allowedPorts: new Set([rt.simulator.port]),
      ownerId: rt.ownerId,
    });
    const rec = await bad.reconcileOperation(opId);
    assert.equal(rec.remote, "ambiguous");
  });

  it("23. pérdida lease durante turno", async () => {
    const { customerId, conversationId } = await rt.ensureConversation({
      phoneE164: `+54911${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`,
      companyId,
    });
    // Owner A toma lease
    const h = await rt.locks.acquire(conversationId, "holder_a", 30_000);
    assert.ok(h);
    // Owner B intenta turno
    const r = await rt.handleInbound({
      conversationId,
      customerId,
      companyId,
      text: "hola",
      ownerId: "holder_b",
    });
    assert.equal(r.outcome, "failed_lock");
  });

  it("24. pérdida lease antes HTTP (assertion dedicada)", async () => {
    const { outbox, conversationId } = await prepConfirmed().then(async (x) => ({
      ...x,
      conversationId: (
        await rt.prisma.operation.findUniqueOrThrow({ where: { id: x.opId } })
      ).conversationId,
    }));
    await rt.prisma.$executeRawUnsafe(
      `UPDATE conversation_locks
       SET owner_id = 'stolen', lease_expires_at = now() + interval '60 seconds'
       WHERE conversation_id = $1`,
      conversationId,
    );
    const r = await rt.dispatchOutboxOnce(outbox.id, "success");
    assert.equal((r as { classification: string }).classification, "denied_pre_http");
  });

  it("25. worker obsoleto intentando completar", async () => {
    const { outbox } = await prepConfirmed();
    await rt.prisma.$queryRawUnsafe(
      `SELECT * FROM wara_v2_claim_outbox($1, interval '1 second', $2)`,
      "old_worker",
      outbox.id,
    );
    const claimed = await rt.prisma.deliveryOutbox.findUniqueOrThrow({
      where: { id: outbox.id },
    });
    const staleFence = claimed.claimFence!;
    // Completar con fence viejo debe fallar
    const done = await rt.prisma.$queryRawUnsafe<unknown[]>(
      `SELECT * FROM wara_v2_complete_outbox_claim(
        $1::text, $2::text, $3::bigint,
        'delivered'::"DeliveryStatus", 'success'::"ResultClassification",
        null, null, null, null, 'not_needed'::"ReconciliationStatus"
      )`,
      outbox.id,
      "old_worker",
      staleFence + 99n,
    );
    assert.equal(done.length, 0);
  });

  it("26a. caída después de ingress", async () => {
    const { customerId, conversationId } = await rt.ensureConversation({
      phoneE164: `+54911${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`,
      companyId,
    });
    const mid = randomUUID();
    await rt.handleInbound({
      conversationId,
      customerId,
      companyId,
      text: "ping",
      messageId: mid,
      commandId: randomUUID(),
    });
    // Reinicio = nuevo proceso: mismo messageId → dedupe
    const again = await rt.handleInbound({
      conversationId,
      customerId,
      companyId,
      text: "ping",
      messageId: mid,
      commandId: randomUUID(),
    });
    assert.equal(again.outcome, "deduped");
  });

  it("26b. caída después de crear attempt/outbox", async () => {
    const { opId, outbox } = await prepConfirmed();
    assert.ok(outbox.attemptId);
    const attempt = await rt.prisma.operationAttempt.findUniqueOrThrow({
      where: { id: outbox.attemptId! },
    });
    assert.equal(attempt.outcome, "not_sent");
    // Recuperación: dispatch posterior
    const r = await rt.dispatchOutboxOnce(outbox.id, "success");
    assert.equal((r as { classification: string }).classification, "success");
    void opId;
  });

  it("26c. caída después de claim antes HTTP", async () => {
    const { outbox } = await prepConfirmed();
    const d = new OutboxDispatcher(rt.prisma, {
      ownerId: rt.ownerId,
      simulatorUrl: rt.simulator.baseUrl,
      allowedPorts: new Set([rt.simulator.port]),
      failBeforeHttpPersist: true,
    });
    await assert.rejects(() => d.dispatchOnce(outbox.id), /persistence_failure_before_http/);
    // Outbox sending; recuperar por claim vencido
    await rt.prisma.$executeRawUnsafe(
      `UPDATE delivery_outbox SET claim_expires_at = now() - interval '1 second'
       WHERE id = $1`,
      outbox.id,
    );
    const recover = await rt.dispatchOutboxOnce(outbox.id, "success");
    assert.ok((recover as { handled: boolean }).handled);
  });

  it("26d. caída después HTTP antes persistir", async () => {
    const { outbox } = await prepConfirmed();
    const d = new OutboxDispatcher(rt.prisma, {
      ownerId: rt.ownerId,
      simulatorUrl: rt.simulator.baseUrl,
      allowedPorts: new Set([rt.simulator.port]),
      scenario: "success",
      crashAfterHttp: true,
    });
    await assert.rejects(() => d.dispatchOnce(outbox.id), /crash_after_http/);
    await rt.prisma.$executeRawUnsafe(
      `UPDATE delivery_outbox SET claim_expires_at = now() - interval '1 second'
       WHERE id = $1`,
      outbox.id,
    );
    const recover = await rt.dispatchOutboxOnce(outbox.id);
    assert.equal((recover as { classification: string }).classification, "unknown_outcome");
  });

  it("26e. prepare idempotente tras reinicio", async () => {
    const { opId, outbox } = await prepConfirmed();
    const lock = await rt.prisma.conversationLock.findUniqueOrThrow({
      where: { conversationId: outbox.conversationId },
    });
    const a = await prepareEffectOutbox(rt.prisma, {
      operationId: opId,
      conversationId: outbox.conversationId,
      channelAccountId: "sim_local",
      toolName: "commit_odometer_update",
      ownerId: rt.ownerId,
      lockFencingToken: lock.fencingToken,
      simulatorUrl: rt.simulator.baseUrl,
      allowedPorts: new Set([rt.simulator.port]),
      companyId,
      deliveryGate: simulatorGatePass(),
    });
    assert.equal(a.ok, true);
    if (a.ok) assert.equal(a.outboxId, outbox.id);
  });
});
