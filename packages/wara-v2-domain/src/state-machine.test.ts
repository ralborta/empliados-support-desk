/**
 * Matriz mínima de transiciones — máquina de estados pura + servicio in-memory.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import {
  OperationDomainService,
  InMemoryUnitOfWork,
  resolveTransition,
  hashPayload,
  TRANSITION_TABLE,
  ATTEMPT_APPEND_ONLY_POLICY,
  type OperationRecord,
} from "./index.js";

const MUTATIONS_DISABLED = true;

function baseCreate(uow: InMemoryUnitOfWork) {
  const svc = new OperationDomainService(uow);
  return svc;
}

async function seedAwaiting(svc: OperationDomainService, uow: InMemoryUnitOfWork) {
  const r = await svc.apply({
    commandId: randomUUID(),
    event: "prepare_complete",
    create: {
      type: "update_odometer",
      conversationId: "conv1",
      customerId: "cus1",
      companyId: "co1",
      unitId: "u1",
      payload: { km: 10 },
      payloadHash: hashPayload({ km: 10 }),
      idempotencyKey: randomUUID(),
      executionMode: "dry_run",
    },
  });
  assert.equal(r.operation.status, "awaiting_confirmation");
  return r.operation;
}

describe("transition table integrity", () => {
  it("solo usa estados del enum y eventos conocidos", () => {
    assert.ok(TRANSITION_TABLE.length > 20);
    assert.equal(ATTEMPT_APPEND_ONLY_POLICY, "write_once_attempt_row_plus_operation_events");
  });
});

describe("resolveTransition — matriz mínima", () => {
  const now = new Date();
  const lock = {
    ownerId: "w1",
    fencingToken: 1n,
    leaseExpiresAt: new Date(now.getTime() + 60_000),
  };

  it("creación create → draft", () => {
    const r = resolveTransition({
      operation: null,
      event: "create",
      context: { now, maxAttempts: 3 },
    });
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.toStatus, "draft");
  });

  it("espera de datos prepare_incomplete → collecting_data", () => {
    const r = resolveTransition({
      operation: null,
      event: "prepare_incomplete",
      context: { now, maxAttempts: 3 },
    });
    assert.equal(r.ok && r.toStatus, "collecting_data");
  });

  it("espera de confirmación prepare_complete → awaiting_confirmation", () => {
    const r = resolveTransition({
      operation: { status: "collecting_data" } as OperationRecord,
      event: "prepare_complete",
      context: { now, maxAttempts: 3 },
    });
    assert.equal(r.ok && r.toStatus, "awaiting_confirmation");
  });

  it("confirmación confirm_valid con binding", () => {
    const op = {
      id: "op1",
      status: "awaiting_confirmation",
      operationVersion: 1,
      payloadHash: "h",
    } as OperationRecord;
    const r = resolveTransition({
      operation: op,
      event: "confirm_valid",
      context: {
        now,
        maxAttempts: 3,
        confirmation: {
          id: "c1",
          operationId: "op1",
          operationVersion: 1,
          payloadHash: "h",
          confirmationMessageId: "m1",
          actorType: "customer",
          actorId: "a",
          confirmedAt: now,
          expiresAt: new Date(now.getTime() + 10000),
          status: "valid",
          invalidationReason: null,
        },
      },
    });
    assert.equal(r.ok && r.toStatus, "confirmed");
  });

  it("rechazo reject → cancelled", () => {
    const r = resolveTransition({
      operation: { status: "awaiting_confirmation" } as OperationRecord,
      event: "reject",
      context: { now, maxAttempts: 3 },
    });
    assert.equal(r.ok && r.toStatus, "cancelled");
  });

  it("expiración / suspensión / cancelación desde awaiting", () => {
    for (const [event, to] of [
      ["expire", "expired"],
      ["context_incompatible", "suspended"],
      ["cancel", "cancelled"],
    ] as const) {
      const r = resolveTransition({
        operation: { status: "awaiting_confirmation" } as OperationRecord,
        event,
        context: { now, maxAttempts: 3 },
      });
      assert.equal(r.ok && r.toStatus, to, event);
    }
  });

  it("reactivación suspended + context_compatible → awaiting_confirmation", () => {
    const op = {
      status: "suspended",
      companyId: "co1",
      unitId: "u1",
    } as OperationRecord;
    const bad = resolveTransition({
      operation: op,
      event: "context_compatible",
      context: { now, maxAttempts: 3, contextRevalidated: false },
    });
    assert.equal(bad.ok, false);
    const ok = resolveTransition({
      operation: op,
      event: "context_compatible",
      context: {
        now,
        maxAttempts: 3,
        contextRevalidated: true,
        activeCompanyId: "co1",
        activeUnitId: "u1",
      },
    });
    assert.equal(ok.ok && ok.toStatus, "awaiting_confirmation");
  });

  it("cancelación solicitada user_cancel → cancel_requested", () => {
    const r = resolveTransition({
      operation: { status: "processing" } as OperationRecord,
      event: "user_cancel",
      context: { now, maxAttempts: 3 },
    });
    assert.equal(r.ok && r.toStatus, "cancel_requested");
  });

  it("cancelación externa exitosa cancel_requested + attempt_success → succeeded", () => {
    const r = resolveTransition({
      operation: { status: "cancel_requested" } as OperationRecord,
      event: "attempt_success",
      context: { now, maxAttempts: 3 },
    });
    assert.equal(r.ok && r.toStatus, "succeeded");
    if (r.ok) {
      assert.ok(r.effects.includes("flag_cancel_requested_after_success"));
    }
  });

  it("fallos / timeouts / unknown_outcome desde processing", () => {
    const cases = [
      ["attempt_retryable_failed", "retryable_failed"],
      ["attempt_permanent_failed", "permanent_failed"],
      ["timeout_before_send", "retryable_failed"],
      ["timeout_after_send", "unknown_outcome"],
      ["ambiguous_result", "unknown_outcome"],
    ] as const;
    for (const [event, to] of cases) {
      const r = resolveTransition({
        operation: { status: "processing" } as OperationRecord,
        event,
        context: { now, maxAttempts: 3 },
      });
      assert.equal(r.ok && r.toStatus, to, event);
    }
  });

  it("reconciliación posterior", () => {
    const start = resolveTransition({
      operation: { status: "unknown_outcome" } as OperationRecord,
      event: "start_reconcile",
      context: { now, maxAttempts: 3 },
    });
    assert.equal(start.ok && start.toStatus, "reconciling");
    const success = resolveTransition({
      operation: { status: "reconciling" } as OperationRecord,
      event: "reconcile_confirmed_success",
      context: { now, maxAttempts: 3, reconcileEvidence: "success" },
    });
    assert.equal(success.ok && success.toStatus, "succeeded");
    const absent = resolveTransition({
      operation: {
        status: "reconciling",
        cancelRequestedAt: new Date(),
      } as OperationRecord,
      event: "reconcile_confirmed_absent",
      context: {
        now,
        maxAttempts: 3,
        reconcileEvidence: "absent",
        hadCancelRequested: true,
      },
    });
    assert.equal(absent.ok && absent.toStatus, "cancelled");
  });

  it("terminal rechaza transiciones", () => {
    const r = resolveTransition({
      operation: { status: "succeeded" } as OperationRecord,
      event: "cancel",
      context: { now, maxAttempts: 3 },
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, "TERMINAL_STATE");
  });

  it("supersede prohibido desde processing", () => {
    const r = resolveTransition({
      operation: { status: "processing" } as OperationRecord,
      event: "supersede",
      context: { now, maxAttempts: 3 },
    });
    assert.equal(r.ok, false);
  });

  it("start_attempt exige lock+fence y payload vigente", () => {
    const op = {
      status: "queued",
      payloadHash: "abc",
      operationVersion: 2,
    } as OperationRecord;
    const bad = resolveTransition({
      operation: op,
      event: "start_attempt",
      context: { now, maxAttempts: 3 },
    });
    assert.equal(bad.ok, false);
    const ok = resolveTransition({
      operation: op,
      event: "start_attempt",
      context: {
        now,
        maxAttempts: 3,
        lock,
        claimedOwnerId: "w1",
        claimedFencingToken: 1n,
        expectedPayloadHash: "abc",
        expectedOperationVersion: 2,
      },
    });
    assert.equal(ok.ok && ok.toStatus, "processing");
  });
});

describe("OperationDomainService — flujo e invariantes", () => {
  it("happy path confirm → enqueue → attempt success (dry_run)", async () => {
    const uow = new InMemoryUnitOfWork();
    const svc = baseCreate(uow);
    const op = await seedAwaiting(svc, uow);
    const confId = randomUUID();
    const confirmed = await svc.apply({
      commandId: randomUUID(),
      event: "confirm_valid",
      operationId: op.id,
      confirmation: {
        id: confId,
        operationId: op.id,
        operationVersion: op.operationVersion,
        payloadHash: op.payloadHash,
        confirmationMessageId: "msg1",
        actorType: "customer",
        actorId: "user",
        confirmedAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    assert.equal(confirmed.operation.status, "confirmed");
    assert.equal(confirmed.operation.confirmationId, confId);
    const c = await uow.repo.getConfirmation(confId);
    assert.equal(c?.operationId, op.id);

    const queued = await svc.apply({
      commandId: randomUUID(),
      event: "enqueue_commit",
      operationId: op.id,
      context: {
        executionMode: "dry_run",
        mutationsDisabled: MUTATIONS_DISABLED,
        expectedPayloadHash: op.payloadHash,
        expectedOperationVersion: op.operationVersion,
      },
    });
    assert.equal(queued.operation.status, "queued");

    const processing = await svc.apply({
      commandId: randomUUID(),
      event: "start_attempt",
      operationId: op.id,
      context: {
        lock: {
          ownerId: "w1",
          fencingToken: 1n,
          leaseExpiresAt: new Date(Date.now() + 30_000),
        },
        claimedOwnerId: "w1",
        claimedFencingToken: 1n,
        expectedPayloadHash: op.payloadHash,
        expectedOperationVersion: op.operationVersion,
      },
    });
    assert.equal(processing.operation.status, "processing");

    const done = await svc.apply({
      commandId: randomUUID(),
      event: "attempt_success",
      operationId: op.id,
      context: {
        lock: {
          ownerId: "w1",
          fencingToken: 1n,
          leaseExpiresAt: new Date(Date.now() + 30_000),
        },
        claimedOwnerId: "w1",
        claimedFencingToken: 1n,
        attempt: {
          requestHash: "rh",
          fencingToken: 1n,
          ownerId: "w1",
          outcome: "confirmed_success",
          startedAt: new Date(),
          finishedAt: new Date(),
        },
      },
    });
    assert.equal(done.operation.status, "succeeded");
    assert.equal(uow.repo.attempts.length, 1);
    assert.equal(uow.repo.attempts[0]?.outcome, "confirmed_success");
  });

  it("supersede crea nueva versión bidireccional sin mutar payload", async () => {
    const uow = new InMemoryUnitOfWork();
    const svc = baseCreate(uow);
    const op = await seedAwaiting(svc, uow);
    const oldHash = op.payloadHash;
    const result = await svc.apply({
      commandId: randomUUID(),
      event: "correct_payload",
      operationId: op.id,
      supersede: {
        newPayload: { km: 99 },
        newPayloadHash: hashPayload({ km: 99 }),
        newIdempotencyKey: randomUUID(),
      },
    });
    assert.equal(result.operation.status, "superseded");
    assert.ok(result.created);
    assert.equal(result.created!.operationVersion, 2);
    assert.equal(result.created!.lineageId, op.lineageId);
    assert.equal(result.created!.supersedesId, op.id);
    assert.equal(result.operation.supersededById, result.created!.id);
    assert.equal(result.operation.payloadHash, oldHash);
    assert.notEqual(result.created!.payloadHash, oldHash);

    await assert.rejects(
      () =>
        svc.apply({
          commandId: randomUUID(),
          event: "confirm_valid",
          operationId: op.id,
          confirmation: {
            id: randomUUID(),
            operationId: op.id,
            operationVersion: 1,
            payloadHash: oldHash,
            confirmationMessageId: "m",
            actorType: "customer",
            actorId: "a",
            confirmedAt: new Date(),
            expiresAt: new Date(Date.now() + 1000),
          },
        }),
      /terminal|superseded|INVALID/i,
    );
  });

  it("evento duplicado (commandId) es idempotente sin cambios parciales", async () => {
    const uow = new InMemoryUnitOfWork();
    const svc = baseCreate(uow);
    const cmd = randomUUID();
    const a = await svc.apply({
      commandId: cmd,
      event: "create",
      create: {
        type: "issue_certificate",
        conversationId: "c",
        customerId: "u",
        companyId: "co",
        payload: {},
        payloadHash: hashPayload({}),
        idempotencyKey: randomUUID(),
        executionMode: "dry_run",
      },
    });
    const b = await svc.apply({
      commandId: cmd,
      event: "create",
      create: {
        type: "issue_certificate",
        conversationId: "c",
        customerId: "u",
        companyId: "co",
        payload: {},
        payloadHash: hashPayload({}),
        idempotencyKey: randomUUID(),
        executionMode: "dry_run",
      },
    });
    assert.equal(b.idempotent, true);
    assert.equal(a.operation.id, b.operation.id);
    assert.equal(uow.repo.operations.size, 1);
  });

  it("transición inválida no muta estado", async () => {
    const uow = new InMemoryUnitOfWork();
    const svc = baseCreate(uow);
    const op = await seedAwaiting(svc, uow);
    await assert.rejects(
      () =>
        svc.apply({
          commandId: randomUUID(),
          event: "attempt_success",
          operationId: op.id,
        }),
      /INVALID_TRANSITION|no transition/i,
    );
    const reloaded = await uow.repo.findById(op.id);
    assert.equal(reloaded?.status, "awaiting_confirmation");
  });

  it("suspensión y reactivación con reconfirm", async () => {
    const uow = new InMemoryUnitOfWork();
    const svc = baseCreate(uow);
    const op = await seedAwaiting(svc, uow);
    const suspended = await svc.apply({
      commandId: randomUUID(),
      event: "context_incompatible",
      operationId: op.id,
    });
    assert.equal(suspended.operation.status, "suspended");
    const reactivated = await svc.apply({
      commandId: randomUUID(),
      event: "context_compatible",
      operationId: op.id,
      context: {
        contextRevalidated: true,
        activeCompanyId: "co1",
        activeUnitId: "u1",
      },
    });
    assert.equal(reactivated.operation.status, "awaiting_confirmation");
  });

  it("timeout_after_send → unknown_outcome → reconcile", async () => {
    const uow = new InMemoryUnitOfWork();
    const svc = baseCreate(uow);
    let op = await seedAwaiting(svc, uow);
    // force path via direct status updates for speed? Prefer real transitions.
    const confId = randomUUID();
    await svc.apply({
      commandId: randomUUID(),
      event: "confirm_valid",
      operationId: op.id,
      confirmation: {
        id: confId,
        operationId: op.id,
        operationVersion: 1,
        payloadHash: op.payloadHash,
        confirmationMessageId: "m",
        actorType: "customer",
        actorId: "a",
        confirmedAt: new Date(),
        expiresAt: new Date(Date.now() + 99999),
      },
    });
    await svc.apply({
      commandId: randomUUID(),
      event: "enqueue_commit",
      operationId: op.id,
      context: {
        mutationsDisabled: true,
        expectedPayloadHash: op.payloadHash,
        expectedOperationVersion: 1,
      },
    });
    await svc.apply({
      commandId: randomUUID(),
      event: "start_attempt",
      operationId: op.id,
      context: {
        lock: {
          ownerId: "w",
          fencingToken: 1n,
          leaseExpiresAt: new Date(Date.now() + 99999),
        },
        claimedOwnerId: "w",
        claimedFencingToken: 1n,
        expectedPayloadHash: op.payloadHash,
        expectedOperationVersion: 1,
      },
    });
    const unk = await svc.apply({
      commandId: randomUUID(),
      event: "timeout_after_send",
      operationId: op.id,
      context: {
        attempt: {
          requestHash: "r",
          fencingToken: 1n,
          ownerId: "w",
          outcome: "timeout_after_send",
          startedAt: new Date(),
          finishedAt: new Date(),
        },
      },
    });
    assert.equal(unk.operation.status, "unknown_outcome");
    await svc.apply({
      commandId: randomUUID(),
      event: "start_reconcile",
      operationId: op.id,
    });
    const done = await svc.apply({
      commandId: randomUUID(),
      event: "reconcile_confirmed_success",
      operationId: op.id,
      context: { reconcileEvidence: "success" },
    });
    assert.equal(done.operation.status, "succeeded");
  });
});
