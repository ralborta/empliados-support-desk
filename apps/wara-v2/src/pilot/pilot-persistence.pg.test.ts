/**
 * Persistencia piloto V2 + ejecutor atómico + gates/router — PostgreSQL embebido.
 */
import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import { randomUUID } from "node:crypto";
import { createWaraV2Prisma } from "@wara-v2/db";
import {
  loadPilotStateFromPrisma,
  savePilotStateToPrisma,
  ensurePilotConversationIds,
  resetPilotPrismaForTests,
} from "./pilot-prisma-store.js";
import {
  acquireOperationForExecution,
  completeOperationAttempt,
} from "./operation-executor.js";
import {
  writeGateSnapshot,
  isPilotDryRun,
  isOdometerWriteEnabled,
  isOdooWriteEnabled,
} from "./write-gates.js";
import {
  resolveVersionRoute,
  isVersionRouterEnabled,
  resetRouterMetricsForTests,
} from "./version-router.js";
import { buildProposedWrites } from "./validation-mode.js";
import { createEmptyPilotState } from "./conversation-state.js";

describe("pilot persistence + operation executor", () => {
  const url = process.env.WARA_V2_DATABASE_URL;
  if (!url) {
    it("SKIP: requiere WARA_V2_DATABASE_URL", () => assert.ok(true));
    return;
  }

  const TENANT = "tenant_pg_test";
  const PHONE = "+5491199887766";
  const env = {
    WARA_V2_DATABASE_URL: url,
    WARA_V2_PILOT_PERSISTENCE: "prisma",
    WARA_V2_SHADOW: "true",
    WARA_V2_ODOMETER_WRITE_ENABLED: "false",
    WARA_V2_ODOO_WRITE_ENABLED: "false",
    ALLOW_EXTERNAL_MUTATIONS: "false",
  } as NodeJS.ProcessEnv;

  before(() => {
    process.env.WARA_V2_DATABASE_URL = url;
    process.env.WARA_V2_PILOT_PERSISTENCE = "prisma";
    resetPilotPrismaForTests();
  });

  after(async () => {
    resetPilotPrismaForTests();
  });

  it("gates de escritura deshabilitados por defecto", () => {
    const gates = writeGateSnapshot(env);
    assert.ok(gates.every((g) => !g.enabled));
    assert.equal(isPilotDryRun("odometer", env), true);
    assert.equal(isOdometerWriteEnabled(env), false);
    assert.equal(isOdooWriteEnabled(env), false);
  });

  it("router apagado → V1 por defecto", () => {
    resetRouterMetricsForTests();
    assert.equal(isVersionRouterEnabled(env), false);
    const d = resolveVersionRoute({
      phoneE164: PHONE,
      tenantId: TENANT,
      messageId: "m1",
      env,
    });
    assert.equal(d.route, "v1");
    assert.match(d.reason, /disabled|default/i);
  });

  it("persistencia CAS piloto snapshot", async () => {
    const state = createEmptyPilotState({ tenantId: TENANT, phone: PHONE, customerName: "Lab" });
    state.stateVersion += 1;
    const r1 = await savePilotStateToPrisma(state, env);
    assert.equal(r1.ok, true);
    assert.equal(state.stateVersion, 1);

    const loaded = await loadPilotStateFromPrisma(TENANT, PHONE, env);
    assert.ok(loaded);
    assert.equal(loaded!.stateVersion, 1);
    assert.equal(loaded!.tenantId, TENANT);

    state.selectedUnit = { patente: "AA101AA", label: "M601-001", movilId: 101 };
    state.stateVersion += 1;
    const r2 = await savePilotStateToPrisma(state, env);
    assert.equal(r2.ok, true);
    assert.equal(state.stateVersion, 2);
  });

  it("adquisición atómica — una sola ejecución", async () => {
    const db = createWaraV2Prisma();
    const ids = await ensurePilotConversationIds(TENANT, PHONE, env);
    assert.ok(ids);

    const operationId = randomUUID();
    const payloadHash = randomUUID().replace(/-/g, "");
    await db.operation.create({
      data: {
        id: operationId,
        lineageId: operationId,
        operationVersion: 1,
        type: "update_odometer",
        conversationId: ids!.conversationId,
        customerId: ids!.customerId,
        companyId: TENANT,
        payload: { patente: "AA101AA", odometro: 155000 },
        payloadHash,
        idempotencyKey: payloadHash,
        status: "confirmed",
        sourceMessageId: "msg-1",
        executionMode: "dry_run",
      },
    });

    const owner = "worker-a";
    const fence = BigInt(42);
    const a1 = await acquireOperationForExecution(db, {
      operationId,
      payloadHash,
      ownerId: owner,
      fencingToken: fence,
    });
    assert.equal(a1.ok, true);
    if (!a1.ok || a1.alreadyCompleted) throw new Error("expected acquire");

    const a2 = await acquireOperationForExecution(db, {
      operationId,
      payloadHash,
      ownerId: "worker-b",
      fencingToken: BigInt(43),
    });
    assert.equal(a2.ok, false);
    if (a2.ok) throw new Error("unexpected");
    assert.equal(a2.reason, "conflict");

    const done = await completeOperationAttempt(db, {
      operationId,
      attemptId: a1.attemptId,
      ownerId: owner,
      fencingToken: fence,
      outcome: "confirmed_success",
      externalReference: "WARA-123",
      result: { ok: true },
    });
    assert.equal(done, true);

    const a3 = await acquireOperationForExecution(db, {
      operationId,
      payloadHash,
      ownerId: "worker-c",
      fencingToken: BigInt(44),
    });
    assert.equal(a3.ok, true);
    if (!a3.ok) throw new Error("expected");
    assert.equal(a3.alreadyCompleted, true);
    assert.equal(a3.externalReference, "WARA-123");
  });

  it("unknown_outcome tras timeout post-send", async () => {
    const db = createWaraV2Prisma();
    const ids = await ensurePilotConversationIds(TENANT, PHONE, env);
    assert.ok(ids);

    const operationId = randomUUID();
    const payloadHash = randomUUID().replace(/-/g, "");
    await db.operation.create({
      data: {
        id: operationId,
        lineageId: operationId,
        operationVersion: 1,
        type: "odoo_ticket",
        conversationId: ids!.conversationId,
        customerId: ids!.customerId,
        companyId: TENANT,
        payload: { subject: "test" },
        payloadHash,
        idempotencyKey: payloadHash,
        status: "confirmed",
        executionMode: "shadow",
      },
    });

    const owner = "worker-x";
    const fence = BigInt(99);
    const acq = await acquireOperationForExecution(db, {
      operationId,
      payloadHash,
      ownerId: owner,
      fencingToken: fence,
    });
    assert.equal(acq.ok, true);
    if (!acq.ok || acq.alreadyCompleted) throw new Error("expected acquire");

    await completeOperationAttempt(db, {
      operationId,
      attemptId: acq.attemptId,
      ownerId: owner,
      fencingToken: fence,
      outcome: "timeout_after_send",
      error: { message: "timeout_after_send:AbortError" },
    });

    const op = await db.operation.findUnique({ where: { id: operationId } });
    assert.equal(op?.status, "unknown_outcome");
    const attempt = await db.operationAttempt.findUnique({ where: { id: acq.attemptId } });
    assert.equal(attempt?.reconciliationStatus, "pending");
  });

  it("payloads propuestos para validación real (sin ejecutar)", () => {
    const proposals = buildProposedWrites(env);
    assert.equal(proposals.length, 3);
    for (const p of proposals) {
      assert.ok(p.sanitizedPayload);
      assert.ok(p.reconciliation.includes("unknown") || p.reconciliation.includes("reconcil"));
      assert.ok(p.gates.every((g) => !g.enabled));
    }
  });
});
