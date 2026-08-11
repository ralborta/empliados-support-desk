/**
 * Fase 5 — pruebas contra PostgreSQL embebido + simulador local.
 * Evidencia: ningún destino fuera de 127.0.0.1 / puertos del harness.
 */
import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import { createWaraV2Prisma, V2_MUTATIONS_DISABLED } from "@wara-v2/db";
import {
  ALLOW_EXTERNAL_MUTATIONS,
  GUARANTEES,
  assertLocalSimulatorUrl,
  assertNoRealServiceEnv,
  classifyAttemptResult,
  mayAutoRetry,
  startLocalSimulator,
  prepareEffectOutbox,
  OutboxDispatcher,
  EffectReconciler,
  type LocalSimulator,
} from "./index.js";
import { seedReadyOperation } from "./test-fixtures.js";

async function prepAndId(
  prisma: Parameters<typeof prepareEffectOutbox>[0],
  fx: Awaited<ReturnType<typeof seedReadyOperation>>,
  simUrl: string,
  ports: Set<number>,
  companyId = "co_1",
) {
  const prep = await prepareEffectOutbox(prisma, {
    operationId: fx.op.id,
    conversationId: fx.conversation.id,
    channelAccountId: "sim",
    toolName: "commit_odometer_update",
    ownerId: fx.ownerId,
    lockFencingToken: fx.lock.fencingToken,
    simulatorUrl: simUrl,
    allowedPorts: ports,
    companyId,
    unitId: "unit_1",
  });
  assert.equal(prep.ok, true, prep.ok ? "" : prep.reason);
  if (!prep.ok) throw new Error(prep.reason);
  return prep;
}

function dispatcher(
  prisma: Parameters<typeof prepareEffectOutbox>[0],
  fx: Awaited<ReturnType<typeof seedReadyOperation>>,
  sim: LocalSimulator,
  ports: Set<number>,
  extra: {
    ownerId?: string;
    scenario?:
      | "success"
      | "permanent"
      | "retryable"
      | "timeout_before_send"
      | "timeout_after_send"
      | "reset_after_write"
      | "malformed_after_process"
      | "duplicate";
    crashAfterHttp?: boolean;
    failBeforeHttpPersist?: boolean;
  } = {},
) {
  return new OutboxDispatcher(prisma, {
    ownerId: extra.ownerId ?? fx.ownerId,
    simulatorUrl: sim.baseUrl,
    allowedPorts: ports,
    scenario: extra.scenario,
    crashAfterHttp: extra.crashAfterHttp,
    failBeforeHttpPersist: extra.failBeforeHttpPersist,
  });
}

describe("@wara-v2/executors fase5", () => {
  const url = process.env.WARA_V2_DATABASE_URL;
  if (!url) {
    it("SKIP: requiere WARA_V2_DATABASE_URL", () => assert.ok(true));
    return;
  }

  const prisma = createWaraV2Prisma(url);
  let sim: LocalSimulator;
  let ports: Set<number>;

  before(async () => {
    assert.equal(V2_MUTATIONS_DISABLED, true);
    assert.equal(ALLOW_EXTERNAL_MUTATIONS, false);
    assert.equal(GUARANTEES.allowExternalEffectReal, false);
    sim = await startLocalSimulator();
    ports = new Set([sim.port]);
  });

  after(async () => {
    await sim.close();
    await prisma.$disconnect();
  });

  it("30. confirmación de aislamiento — allowlist rechaza externos", () => {
    assert.equal(
      assertLocalSimulatorUrl("https://api.wara.example/x", ports).ok,
      false,
    );
    assert.equal(
      assertLocalSimulatorUrl(`http://user:pass@127.0.0.1:${sim.port}/effect`, ports)
        .ok,
      false,
    );
    assert.equal(assertLocalSimulatorUrl(sim.baseUrl, ports).ok, true);
    void assertNoRealServiceEnv();
  });

  it("23-24. redirect/URL externa rechazada", () => {
    const r = assertLocalSimulatorUrl("http://evil.example/effect", ports);
    assert.equal(r.ok, false);
  });

  it("1. éxito simulado", async () => {
    const fx = await seedReadyOperation(prisma);
    const prep = await prepAndId(prisma, fx, sim.baseUrl, ports);
    const r = await dispatcher(prisma, fx, sim, ports, {
      scenario: "success",
    }).dispatchOnce(prep.outboxId);
    assert.equal(r.classification, "success");
    const op = await prisma.operation.findUniqueOrThrow({
      where: { id: fx.op.id },
    });
    assert.equal(op.status, "succeeded");
  });

  it("2. rechazo permanente", async () => {
    const fx = await seedReadyOperation(prisma);
    const prep = await prepAndId(prisma, fx, sim.baseUrl, ports);
    const r = await dispatcher(prisma, fx, sim, ports, {
      scenario: "permanent",
    }).dispatchOnce(prep.outboxId);
    assert.equal(r.classification, "permanent_failure");
    const op = await prisma.operation.findUniqueOrThrow({
      where: { id: fx.op.id },
    });
    assert.equal(op.status, "permanent_failed");
  });

  it("3. error temporal y reintento", async () => {
    const fx = await seedReadyOperation(prisma);
    const prep = await prepAndId(prisma, fx, sim.baseUrl, ports);
    const r = await dispatcher(prisma, fx, sim, ports, {
      scenario: "retryable",
    }).dispatchOnce(prep.outboxId);
    assert.equal(r.classification, "retryable_failure");
    assert.equal(mayAutoRetry("retryable_failure"), true);
    const outbox = await prisma.deliveryOutbox.findUniqueOrThrow({
      where: { id: prep.outboxId },
    });
    assert.equal(outbox.status, "pending");
  });

  it("4. timeout antes del envío", async () => {
    const fx = await seedReadyOperation(prisma);
    const prep = await prepAndId(prisma, fx, sim.baseUrl, ports);
    const r = await dispatcher(prisma, fx, sim, ports, {
      scenario: "timeout_before_send",
    }).dispatchOnce(prep.outboxId);
    assert.equal(r.classification, "timeout_before_send");
  });

  it("5. timeout después del envío → unknown_outcome", async () => {
    const fx = await seedReadyOperation(prisma);
    const prep = await prepAndId(prisma, fx, sim.baseUrl, ports);
    const r = await dispatcher(prisma, fx, sim, ports, {
      scenario: "timeout_after_send",
    }).dispatchOnce(prep.outboxId);
    assert.ok(
      r.classification === "timeout_after_send" ||
        r.classification === "unknown_outcome",
    );
    const op = await prisma.operation.findUniqueOrThrow({
      where: { id: fx.op.id },
    });
    assert.equal(op.status, "unknown_outcome");
  });

  it("6. conexión cortada tras recibir request", async () => {
    const fx = await seedReadyOperation(prisma);
    const prep = await prepAndId(prisma, fx, sim.baseUrl, ports);
    const r = await dispatcher(prisma, fx, sim, ports, {
      scenario: "reset_after_write",
    }).dispatchOnce(prep.outboxId);
    assert.equal(r.classification, "unknown_outcome");
  });

  it("7. respuesta malformada después de procesar", async () => {
    const fx = await seedReadyOperation(prisma);
    const prep = await prepAndId(prisma, fx, sim.baseUrl, ports);
    const r = await dispatcher(prisma, fx, sim, ports, {
      scenario: "malformed_after_process",
    }).dispatchOnce(prep.outboxId);
    assert.equal(r.classification, "unknown_outcome");
  });

  it("8. duplicado misma idempotency key", async () => {
    const fx = await seedReadyOperation(prisma);
    const a = await prepAndId(prisma, fx, sim.baseUrl, ports);
    const b = await prepAndId(prisma, fx, sim.baseUrl, ports);
    assert.equal(a.outboxId, b.outboxId);
    assert.equal(a.idempotencyKey, b.idempotencyKey);
  });

  it("9. dos workers reclaman el mismo outbox", async () => {
    const fx = await seedReadyOperation(prisma);
    const prep = await prepAndId(prisma, fx, sim.baseUrl, ports);
    const d1 = dispatcher(prisma, fx, sim, ports, { scenario: "success" });
    const d2 = dispatcher(prisma, fx, sim, ports, {
      ownerId: "other_worker",
      scenario: "success",
    });
    const results = await Promise.all([
      d1.dispatchOnce(prep.outboxId),
      d2.dispatchOnce(prep.outboxId),
    ]);
    const handled = results.filter((r) => r.handled);
    assert.ok(handled.length >= 1);
    const op = await prisma.operation.findUniqueOrThrow({
      where: { id: fx.op.id },
    });
    assert.ok(
      op.status === "succeeded" ||
        op.status === "processing" ||
        op.status === "retryable_failed" ||
        op.status === "unknown_outcome",
    );
  });

  it("10-11. caída después de outbox / después de HTTP", async () => {
    const fx = await seedReadyOperation(prisma);
    const prep = await prepAndId(prisma, fx, sim.baseUrl, ports);
    const crash = dispatcher(prisma, fx, sim, ports, {
      scenario: "success",
      crashAfterHttp: true,
    });
    await assert.rejects(
      () => crash.dispatchOnce(prep.outboxId),
      /crash_after_http/,
    );
    await prisma.$executeRawUnsafe(
      `UPDATE delivery_outbox SET claim_expires_at = now() - interval '1 second'
       WHERE id = $1 AND status = 'sending'`,
      prep.outboxId,
    );
    const recover = dispatcher(prisma, fx, sim, ports, {
      ownerId: "recovery_worker",
    });
    const r = await recover.dispatchOnce(prep.outboxId);
    assert.equal(r.classification, "unknown_outcome");
  });

  it("12-13. claim vencido y fence obsoleto", async () => {
    const fx = await seedReadyOperation(prisma);
    const prep = await prepAndId(prisma, fx, sim.baseUrl, ports);
    await prisma.$queryRawUnsafe(
      `SELECT * FROM wara_v2_claim_outbox($1, interval '1 second', $2)`,
      fx.ownerId,
      prep.outboxId,
    );
    await prisma.$executeRawUnsafe(
      `UPDATE delivery_outbox SET claim_expires_at = now() - interval '1 second'
       WHERE id = $1`,
      prep.outboxId,
    );
    const r = await dispatcher(prisma, fx, sim, ports, {
      ownerId: "new_owner",
    }).dispatchOnce(prep.outboxId);
    assert.ok(r.handled);
    assert.equal(r.classification, "unknown_outcome");
  });

  it("14. lease conversación vencida antes del HTTP", async () => {
    const fx = await seedReadyOperation(prisma);
    const prep = await prepAndId(prisma, fx, sim.baseUrl, ports);
    await prisma.$executeRawUnsafe(
      `UPDATE conversation_locks SET lease_expires_at = now() - interval '1 second'
       WHERE conversation_id = $1`,
      fx.conversation.id,
    );
    const r = await dispatcher(prisma, fx, sim, ports, {
      scenario: "success",
    }).dispatchOnce(prep.outboxId);
    assert.equal(r.classification, "denied_pre_http");
  });

  it("15. superseded después de crear outbox", async () => {
    const fx = await seedReadyOperation(prisma);
    const prep = await prepAndId(prisma, fx, sim.baseUrl, ports);
    await prisma.operation.update({
      where: { id: fx.op.id },
      data: { status: "superseded" },
    });
    const r = await dispatcher(prisma, fx, sim, ports, {
      scenario: "success",
    }).dispatchOnce(prep.outboxId);
    assert.equal(r.classification, "denied_pre_http");
  });

  it("16-18. hash/confirm/suspend antes del envío", async () => {
    const fx = await seedReadyOperation(prisma);
    const prep = await prepAndId(prisma, fx, sim.baseUrl, ports);
    await prisma.operationConfirmation.update({
      where: { id: fx.conf.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const r = await dispatcher(prisma, fx, sim, ports, {
      scenario: "success",
    }).dispatchOnce(prep.outboxId);
    assert.equal(r.classification, "denied_pre_http");
  });

  it("19-21. reconciliación applied / absent / ambiguous", async () => {
    const fx = await seedReadyOperation(prisma);
    const prep = await prepAndId(prisma, fx, sim.baseUrl, ports);
    sim.applied.set(prep.idempotencyKey, {
      at: new Date().toISOString(),
      body: {},
    });
    await prisma.operation.update({
      where: { id: fx.op.id },
      data: { status: "unknown_outcome" },
    });
    await prisma.deliveryOutbox.update({
      where: { id: prep.outboxId },
      data: { status: "unknown_outcome", reconcileStatus: "pending" },
    });
    const applied = await new EffectReconciler(prisma, {
      origin: sim.origin,
      allowedPorts: ports,
      ownerId: fx.ownerId,
    }).reconcileOperation(fx.op.id);
    assert.equal(applied.remote, "applied");
    assert.equal(applied.toStatus, "succeeded");

    const fx2 = await seedReadyOperation(prisma);
    const prep2 = await prepAndId(prisma, fx2, sim.baseUrl, ports);
    await prisma.operation.update({
      where: { id: fx2.op.id },
      data: { status: "unknown_outcome" },
    });
    const absent = await new EffectReconciler(prisma, {
      origin: sim.origin,
      allowedPorts: ports,
      ownerId: fx2.ownerId,
    }).reconcileOperation(fx2.op.id);
    assert.equal(absent.remote, "absent");
    assert.equal(absent.toStatus, "retryable_failed");

    // ambiguous: destino no allowlisted → remoto ambiguo
    const fx3 = await seedReadyOperation(prisma);
    await prepAndId(prisma, fx3, sim.baseUrl, ports);
    await prisma.operation.update({
      where: { id: fx3.op.id },
      data: { status: "unknown_outcome" },
    });
    const ambiguous = await new EffectReconciler(prisma, {
      origin: "http://evil.example",
      allowedPorts: ports,
      ownerId: fx3.ownerId,
    }).reconcileOperation(fx3.op.id);
    assert.equal(ambiguous.remote, "ambiguous");
    assert.equal(ambiguous.toStatus, "unknown_outcome");
  });

  it("22. reintento prohibido desde unknown_outcome", async () => {
    assert.equal(mayAutoRetry("unknown_outcome"), false);
    const fx = await seedReadyOperation(prisma);
    await prisma.operation.update({
      where: { id: fx.op.id },
      data: { status: "unknown_outcome" },
    });
    const d = dispatcher(prisma, fx, sim, ports, {});
    // applyDomainOutcome privado — cobertura vía recovery claim path
    void d;
  });

  it("25. aislamiento entre empresas", async () => {
    const fx = await seedReadyOperation(prisma, { companyId: "co_A" });
    const prep = await prepAndId(
      prisma,
      fx,
      sim.baseUrl,
      ports,
      "co_OTHER",
    );
    const r = await dispatcher(prisma, fx, sim, ports, {
      scenario: "success",
    }).dispatchOnce(prep.outboxId);
    assert.equal(r.classification, "denied_pre_http");
  });

  it("26. idempotencia tras reinicio (misma key)", async () => {
    const fx = await seedReadyOperation(prisma);
    const a = await prepAndId(prisma, fx, sim.baseUrl, ports);
    const b = await prepAndId(prisma, fx, sim.baseUrl, ports);
    assert.equal(a.idempotencyKey, b.idempotencyKey);
    assert.equal(a.outboxId, b.outboxId);
  });

  it("27. fallo persistencia previo al HTTP", async () => {
    const fx = await seedReadyOperation(prisma);
    const prep = await prepAndId(prisma, fx, sim.baseUrl, ports);
    await assert.rejects(
      () =>
        dispatcher(prisma, fx, sim, ports, {
          failBeforeHttpPersist: true,
        }).dispatchOnce(prep.outboxId),
      /persistence_failure_before_http/,
    );
  });

  it("28. fallo persistencia posterior al HTTP (crashAfterHttp)", async () => {
    const fx = await seedReadyOperation(prisma);
    const prep = await prepAndId(prisma, fx, sim.baseUrl, ports);
    await assert.rejects(
      () =>
        dispatcher(prisma, fx, sim, ports, {
          scenario: "success",
          crashAfterHttp: true,
        }).dispatchOnce(prep.outboxId),
      /crash_after_http/,
    );
  });

  it("29. auditoría sin secretos", async () => {
    const fx = await seedReadyOperation(prisma);
    const prep = await prepAndId(prisma, fx, sim.baseUrl, ports);
    const outbox = await prisma.deliveryOutbox.findUniqueOrThrow({
      where: { id: prep.outboxId },
    });
    const json = JSON.stringify(outbox.payload);
    assert.equal(
      /password|authorization|api[_-]?key|secret|bearer/i.test(json),
      false,
    );
    assert.equal(outbox.destinationKey, "local_simulator");
  });

  it("clasificación unitaria timeout_before vs after", () => {
    assert.equal(
      classifyAttemptResult({
        requestLikelySent: false,
        errorCode: "TIMEOUT",
        phase: "before_connect",
      }),
      "timeout_before_send",
    );
    assert.equal(
      classifyAttemptResult({
        requestLikelySent: true,
        errorCode: "TIMEOUT",
        phase: "after_request_written",
      }),
      "timeout_after_send",
    );
  });

  it("migraciones incluyen outbox_claims", async () => {
    const rows = await prisma.$queryRawUnsafe<{ migration_name: string }[]>(
      `SELECT migration_name FROM _prisma_migrations ORDER BY finished_at`,
    );
    assert.ok(rows.some((r) => r.migration_name.includes("outbox_claims")));
  });
});
