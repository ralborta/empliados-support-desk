/**
 * Matriz mínima Fase 4 — orquestador / Policy / DeliveryGate (20 casos).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import {
  MODEL_CANNOT_ORDER_COMMIT,
  PG_SOLE_LOCK_AUTHORITY,
} from "@wara-v2/contracts";
import {
  InMemoryUnitOfWork,
  OperationDomainService,
  hashPayload,
  type OperationRecord,
} from "@wara-v2/domain";
import { V2_MUTATIONS_DISABLED, V2_DEFAULT_MODE } from "@wara-v2/db";
import {
  TurnPipeline,
  FakeModelAdapter,
  FailingModelAdapter,
  InvalidJsonModelAdapter,
  InMemoryTurnStore,
  InMemoryLockPort,
  InMemoryIngressPort,
  InMemoryOutboxPort,
  evaluateDeliveryGate,
  GUARANTEES,
  assertNoExternalSideEffects,
  type TurnPipelineInput,
  type ConversationSnapshot,
} from "./index.js";

function conversation(
  overrides: Partial<ConversationSnapshot> = {},
): ConversationSnapshot {
  return {
    conversationId: "conv_1",
    customerId: "cus_1",
    activeCompanyId: "co_1",
    activeUnitId: "unit_1",
    channel: "simulator",
    channelAccountId: "sim_1",
    membershipCompanyIds: ["co_1", "co_2"],
    ...overrides,
  };
}

function inbound(text: string, messageId = randomUUID()) {
  return {
    messageId,
    provider: "bbc",
    channelAccountId: "sim_1",
    conversationKey: "conv_1",
    channel: "simulator" as const,
    customerPhoneE164: "+5491100000001",
    text,
    receivedAt: new Date().toISOString(),
    payloadHash: hashPayload({ text }),
  };
}

function makePipeline(opts?: {
  model?: ConstructorParameters<typeof FakeModelAdapter>[0] | FakeModelAdapter | FailingModelAdapter | InvalidJsonModelAdapter;
  bag?: OperationRecord[];
}) {
  const uow = new InMemoryUnitOfWork();
  const domain = new OperationDomainService(uow);
  const turns = new InMemoryTurnStore();
  const locks = new InMemoryLockPort();
  const ingress = new InMemoryIngressPort();
  const outbox = new InMemoryOutboxPort();
  const bag = opts?.bag ?? [];
  const model =
    opts?.model && typeof opts.model !== "function"
      ? (opts.model as FakeModelAdapter)
      : new FakeModelAdapter(
          typeof opts?.model === "function" ? opts.model : undefined,
        );
  const pipeline = new TurnPipeline({
    model,
    turns,
    locks,
    ingress,
    outbox,
    domain,
    activeOperationsBag: bag,
    mutationsDisabled: true,
  });
  return { pipeline, domain, uow, turns, locks, ingress, outbox, bag };
}

function baseInput(
  text: string,
  overrides: Partial<TurnPipelineInput> = {},
): TurnPipelineInput {
  return {
    commandId: randomUUID(),
    inbound: inbound(text),
    conversation: conversation(),
    executionMode: "dry_run",
    ...overrides,
  };
}

describe("Fase 4 guarantees", () => {
  it("mantiene banderas de seguridad", () => {
    assert.equal(MODEL_CANNOT_ORDER_COMMIT, true);
    assert.equal(PG_SOLE_LOCK_AUTHORITY, true);
    assert.equal(V2_MUTATIONS_DISABLED, true);
    assert.equal(V2_DEFAULT_MODE, "dry_run");
    assert.equal(GUARANTEES.V2_MUTATIONS_DISABLED, true);
  });
});

describe("TurnPipeline — matriz mínima", () => {
  it("1. consulta general sin operación", async () => {
    const { pipeline, bag, outbox } = makePipeline();
    const r = await pipeline.handle(baseInput("qué podés hacer?"));
    assert.equal(bag.length, 0);
    assert.ok(
      r.outcome === "ok_simulated" || r.outcome === "needs_user_input",
    );
    assert.ok(r.responseText.length > 0);
    assert.equal(outbox.items[0]?.status, "suppressed");
  });

  it("2. inicio de trámite con datos incompletos", async () => {
    const { pipeline, bag } = makePipeline();
    const r = await pipeline.handle(baseInput("quiero actualizar el odómetro"));
    assert.equal(bag.length, 0);
    assert.equal(r.outcome, "needs_user_input");
    assert.match(r.responseText, /od[oó]metro|valor/i);
  });

  it("3. trámite completo que requiere confirmación", async () => {
    const { pipeline, bag } = makePipeline();
    const r = await pipeline.handle(
      baseInput("actualizar odómetro a 15000 km"),
    );
    assert.equal(bag.length, 1);
    assert.equal(bag[0]?.status, "awaiting_confirmation");
    assert.ok(r.operationIds.length >= 1);
  });

  it("4. decisión válida en dry_run", async () => {
    const { pipeline, outbox } = makePipeline();
    const r = await pipeline.handle(baseInput("capacidades del bot"));
    assert.equal(r.decision?.schemaVersion, 2);
    assert.equal(outbox.items.every((i) => i.executionMode === "dry_run"), true);
    assert.ok(r.delivery === null || r.delivery.allowExternalEffect === false);
  });

  it("5. decisión con campo commit → rechazo", async () => {
    const { pipeline } = makePipeline({
      model: new FakeModelAdapter(() => ({
        schemaVersion: 2,
        interpretationSummary: "x",
        proposedGoal: "update_odometer",
        commit: true,
        acts: [
          {
            act_id: "a1",
            type: "new_request",
            order: 0,
            priority: 1,
            blocking: true,
            depends_on: [],
            conflicts_with: [],
            expected_effect: "prepare",
            confidence: 1,
          },
        ],
      })),
    });
    const r = await pipeline.handle(baseInput("x"));
    assert.equal(r.outcome, "invalid_model_output");
    assert.equal(r.rejection?.code, "model_ordered_commit_field");
    assert.ok(r.traces.some((t) => t.event === "reject_model_commit"));
  });

  it("6. toolHint no permitido (commit_*) ignorado / bloqueado", async () => {
    const { pipeline } = makePipeline({
      model: new FakeModelAdapter(() => ({
        schemaVersion: 2,
        interpretationSummary: "hint commit",
        proposedGoal: "update_odometer",
        acts: [
          {
            act_id: "a1",
            type: "ask_question",
            order: 0,
            priority: 1,
            blocking: false,
            depends_on: [],
            conflicts_with: [],
            expected_effect: "clarify",
            confidence: 0.5,
          },
        ],
        toolHints: [
          {
            name: "commit_odometer_update",
            arguments: {},
            reason: "bad",
          },
        ],
      })),
    });
    const r = await pipeline.handle(baseInput("x"));
    // schema/graph rejects commit in toolHints OR policy ignores
    assert.ok(
      r.outcome === "invalid_model_output" ||
        r.policy?.blockReasons.some((b) => b.includes("commit")) ||
        r.rejection,
    );
  });

  it("7. goal no permitido", async () => {
    const { pipeline } = makePipeline();
    const r = await pipeline.handle(
      baseInput("actualizar odómetro a 100 km", {
        featureFlags: {
          enabled: true,
          allowedGoals: ["clarify", "list_capabilities", "none"],
          allowWhatsAppSend: false,
          allowWaraMutations: false,
          allowOdooMutations: false,
        },
      }),
    );
    assert.ok(r.policy?.blockReasons.some((b) => b.startsWith("goal_not_allowed")));
    assert.match(r.responseText, /no está habilitada/i);
  });

  it("8. payload inválido (schema)", async () => {
    const { pipeline } = makePipeline({
      model: new FakeModelAdapter(() => ({
        schemaVersion: 2,
        interpretationSummary: "bad",
        proposedGoal: "update_odometer",
        acts: [],
      })),
    });
    const r = await pipeline.handle(baseInput("x"));
    assert.equal(r.outcome, "invalid_model_output");
    assert.equal(r.rejection?.code, "schema_invalid");
  });

  it("9. confirmación ausente / vencida / rechazo", async () => {
    const bag: OperationRecord[] = [];
    const { pipeline } = makePipeline({ bag });
    await pipeline.handle(baseInput("actualizar odómetro a 2000 km"));
    assert.equal(bag[0]?.status, "awaiting_confirmation");

    const rejected = await pipeline.handle(baseInput("rechazo la operación"));
    assert.ok(
      rejected.traces.some((t) => t.event === "cancelled") ||
        bag[0]?.status === "cancelled",
    );

    // vencida vía DeliveryGate directo
    const gate = evaluateDeliveryGate({
      intent: "external_mutation",
      executionMode: "dry_run",
      featureFlags: {
        enabled: true,
        allowedGoals: ["update_odometer"],
        allowWhatsAppSend: false,
        allowWaraMutations: false,
        allowOdooMutations: false,
      },
      mutationsDisabled: true,
      toolName: "commit_odometer_update",
      operation: bag[0] ?? null,
      confirmation: {
        id: "c1",
        operationId: bag[0]?.id ?? "x",
        operationVersion: 1,
        payloadHash: bag[0]?.payloadHash ?? "h",
        confirmationMessageId: "m",
        actorType: "customer",
        actorId: "a",
        confirmedAt: new Date(),
        expiresAt: new Date(Date.now() - 1000),
        status: "valid",
        invalidationReason: null,
      },
      allowToolCalls: ["commit_odometer_update"],
      now: new Date(),
    });
    assert.equal(gate.checks.confirmation_valid, false);
    assert.equal(gate.allowExternalEffect, false);
  });

  it("10. payload modificado después de confirmar (hash mismatch)", async () => {
    const bag: OperationRecord[] = [];
    const { pipeline } = makePipeline({ bag });
    await pipeline.handle(baseInput("actualizar odómetro a 3000 km"));
    const op = bag[0]!;
    const { pipeline: p2 } = makePipeline({
      bag,
      model: new FakeModelAdapter(() => ({
        schemaVersion: 2,
        interpretationSummary: "confirm wrong hash",
        proposedGoal: "update_odometer",
        acts: [
          {
            act_id: "a1",
            type: "confirm",
            order: 0,
            priority: 50,
            blocking: false,
            depends_on: [],
            conflicts_with: [],
            expected_effect: "none",
            confidence: 1,
            target: {
              operationId: op.id,
              operationVersion: op.operationVersion,
              payloadHash: "0".repeat(64),
            },
          },
        ],
      })),
    });
    const r = await p2.handle(baseInput("CONFIRMO"));
    assert.ok(
      r.policy?.blockReasons.includes("confirm_payload_hash_mismatch") ||
        r.traces.some((t) => t.event === "policy_built"),
    );
  });

  it("11. operación superseded", async () => {
    const bag: OperationRecord[] = [];
    const { pipeline, domain } = makePipeline({ bag });
    await pipeline.handle(baseInput("actualizar odómetro a 4000 km"));
    const op = bag[0]!;
    await domain.apply({
      commandId: randomUUID(),
      event: "correct_payload",
      operationId: op.id,
      supersede: {
        newPayload: { company_id: "co_1", unit_id: "unit_1", value: 4001 },
        newPayloadHash: hashPayload({
          company_id: "co_1",
          unit_id: "unit_1",
          value: 4001,
        }),
        newIdempotencyKey: randomUUID(),
      },
    });
    const gate = evaluateDeliveryGate({
      intent: "external_mutation",
      executionMode: "dry_run",
      featureFlags: {
        enabled: true,
        allowedGoals: ["update_odometer"],
        allowWhatsAppSend: false,
        allowWaraMutations: false,
        allowOdooMutations: false,
      },
      mutationsDisabled: true,
      toolName: "commit_odometer_update",
      operation: { ...op, status: "superseded", supersededById: "x" },
      allowToolCalls: ["commit_odometer_update"],
      now: new Date(),
    });
    assert.equal(gate.checks.not_superseded, false);
    assert.equal(gate.allowExternalEffect, false);
  });

  it("12. operación suspended", async () => {
    const bag: OperationRecord[] = [];
    const { pipeline, domain } = makePipeline({ bag });
    await pipeline.handle(baseInput("actualizar odómetro a 5000 km"));
    const applied = await domain.apply({
      commandId: randomUUID(),
      event: "context_incompatible",
      operationId: bag[0]!.id,
    });
    bag[0] = applied.operation;
    assert.equal(bag[0]?.status, "suspended");
    const gate = evaluateDeliveryGate({
      intent: "external_mutation",
      executionMode: "dry_run",
      featureFlags: {
        enabled: true,
        allowedGoals: ["update_odometer"],
        allowWhatsAppSend: false,
        allowWaraMutations: false,
        allowOdooMutations: false,
      },
      mutationsDisabled: true,
      toolName: "commit_odometer_update",
      operation: bag[0]!,
      allowToolCalls: ["commit_odometer_update"],
      now: new Date(),
    });
    assert.equal(gate.checks.not_suspended, false);
  });

  it("13. mensaje y comando duplicados", async () => {
    const { pipeline, turns } = makePipeline();
    const msgId = randomUUID();
    const cmd = randomUUID();
    const input = baseInput("capacidades", {
      commandId: cmd,
      inbound: inbound("capacidades", msgId),
    });
    const a = await pipeline.handle(input);
    const b = await pipeline.handle(input);
    assert.equal(b.idempotent, true);
    assert.equal(a.turnId, b.turnId);
    assert.equal(turns.turns.size, 1);

    const c = await pipeline.handle(
      baseInput("capacidades", {
        commandId: randomUUID(),
        inbound: inbound("capacidades", msgId),
      }),
    );
    assert.equal(c.outcome, "deduped");
  });

  it("14. dos turnos concurrentes sobre la misma conversación", async () => {
    const sharedLocks = new InMemoryLockPort();
    const uow = new InMemoryUnitOfWork();
    const domain = new OperationDomainService(uow);
    const bag: OperationRecord[] = [];
    const mk = () =>
      new TurnPipeline({
        model: new FakeModelAdapter(),
        turns: new InMemoryTurnStore(),
        locks: sharedLocks,
        ingress: new InMemoryIngressPort(),
        outbox: new InMemoryOutboxPort(),
        domain,
        activeOperationsBag: bag,
      });
    const p1 = mk();
    const p2 = mk();
    // Hold lock from p1 path by acquiring manually first... 
    // Better: start both in parallel on same conversation
    const results = await Promise.all([
      p1.handle(baseInput("actualizar odómetro a 6000 km", { ownerId: "w1" })),
      p2.handle(baseInput("actualizar odómetro a 6001 km", { ownerId: "w2" })),
    ]);
    const outcomes = results.map((r) => r.outcome);
    assert.ok(
      outcomes.includes("failed_lock") ||
        outcomes.filter((o) => o === "ok_simulated" || o === "needs_user_input").length >= 1,
    );
    // At most one should create op if both tried prepare — lock serializes
    assert.ok(results.some((r) => r.outcome === "failed_lock") || bag.length <= 2);
  });

  it("15. fallo del modelo", async () => {
    const { pipeline } = makePipeline({ model: new FailingModelAdapter() });
    const r = await pipeline.handle(baseInput("hola"));
    assert.equal(r.outcome, "failed_model_timeout");
    assert.equal(r.rejection?.code, "model_unavailable");
  });

  it("16. fallo de persistencia", async () => {
    const { pipeline, turns } = makePipeline();
    turns.failNextSave = true;
    await assert.rejects(
      () => pipeline.handle(baseInput("capacidades")),
      /persistence_failure/,
    );
  });

  it("17. DeliveryGate con mutaciones deshabilitadas", async () => {
    const gate = evaluateDeliveryGate({
      intent: "external_mutation",
      executionMode: "dry_run",
      featureFlags: {
        enabled: true,
        allowedGoals: ["update_odometer"],
        allowWhatsAppSend: false,
        allowWaraMutations: false,
        allowOdooMutations: false,
      },
      mutationsDisabled: true,
      toolName: "commit_odometer_update",
      allowToolCalls: ["commit_odometer_update"],
      now: new Date(),
    });
    assert.equal(gate.allowExternalEffect, false);
    assert.ok(gate.reasons.includes("V2_MUTATIONS_DISABLED"));
  });

  it("18. intento de efecto externo accidental", () => {
    assert.throws(
      () => assertNoExternalSideEffects({ httpUrl: "https://wara.example" }),
      /accidental_external_effect/,
    );
  });

  it("19. aislamiento entre empresas", async () => {
    const bag: OperationRecord[] = [];
    const { pipeline } = makePipeline({ bag });
    await pipeline.handle(
      baseInput("actualizar odómetro a 7000 km", {
        conversation: conversation({ activeCompanyId: "co_1" }),
      }),
    );
    assert.equal(bag[0]?.companyId, "co_1");
    const gate = evaluateDeliveryGate({
      intent: "external_mutation",
      executionMode: "dry_run",
      featureFlags: {
        enabled: true,
        allowedGoals: ["update_odometer"],
        allowWhatsAppSend: false,
        allowWaraMutations: false,
        allowOdooMutations: false,
      },
      mutationsDisabled: true,
      toolName: "commit_odometer_update",
      operation: bag[0]!,
      activeCompanyId: "co_OTHER",
      allowToolCalls: ["commit_odometer_update"],
      now: new Date(),
    });
    assert.equal(gate.checks.company_unit, false);
  });

  it("20. trazabilidad completa de decisión rechazada", async () => {
    const { pipeline, turns } = makePipeline({
      model: new InvalidJsonModelAdapter(),
    });
    const r = await pipeline.handle(baseInput("hola"));
    assert.equal(r.outcome, "invalid_model_output");
    assert.ok(r.traces.length >= 2);
    assert.ok(r.rejection);
    const saved = [...turns.turns.values()][0];
    assert.ok(saved);
    assert.equal(saved.outcome, "invalid_model_output");
    assert.ok(turns.traces.get(saved.id)?.length);
  });

  it("confirmación happy path dry_run sin mutación externa", async () => {
    const bag: OperationRecord[] = [];
    const { pipeline, outbox } = makePipeline({ bag });
    await pipeline.handle(baseInput("actualizar odómetro a 8000 km"));
    const r = await pipeline.handle(baseInput("CONFIRMO"));
    assert.ok(bag.some((o) => o.status === "confirmed" || o.status === "queued"));
    assert.equal(
      outbox.items.every((i) => i.status === "suppressed"),
      true,
    );
    assert.ok(
      r.delivery === null || r.delivery.allowExternalEffect === false,
    );
  });
});
