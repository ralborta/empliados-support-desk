import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createEmptyConversationStateV3 } from "../../commander-v3/types/state.js";
import { decideTurn, filterAuthorizedCapabilities } from "../controller/decide-turn.js";
import { planFromDecision } from "../controller/plan-from-decision.js";
import {
  DUPLICATE_CONFIRM_MESSAGE,
  NO_PENDING_CONFIRM_MESSAGE,
  STALE_CONFIRM_MESSAGE,
} from "../controller/confirmation-guard.js";
import { composeReplyDeterministic } from "../compose/composer.js";
import { migrateV3ToVNext } from "../state/migrate.js";
import type { TurnInterpretation } from "../types/interpretation.js";

function baseInterp(overrides: Partial<TurnInterpretation> = {}): TurnInterpretation {
  return {
    userAct: "confirmation",
    relation: "confirm",
    normalizedMeaning: "Confirma",
    requests: [],
    references: [],
    corrections: [],
    answersExpectedField: false,
    confidence: 0.9,
    ...overrides,
  };
}

function pendingCertState() {
  const s = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
  s.pendingWrite = {
    operationId: "op-current",
    version: 2,
    payloadHash: "h",
    task: "certificate",
    summary: { plate: "ABC123" },
  };
  s.lastQuestion = { id: "c", purpose: "confirm_certificate", expected: "confirmation" };
  s.activeTask = {
    type: "certificate",
    status: "awaiting_confirmation",
    collected: { plate: "ABC123" },
    missing: [],
  };
  return s;
}

function assertNoWrites(decision: ReturnType<typeof decideTurn>) {
  assert.notEqual(decision.action, "confirm_write");
  assert.equal(decision.authorizedCapabilities.length, 0);
  const plan = planFromDecision({ decision, interpretation: baseInterp() });
  assert.equal(plan.requestedCapabilities.length, 0);
  assert.ok(
    !plan.requestedCapabilities.some((c) =>
      /\.(issue|update|create)$/.test(c.name),
    ),
  );
}

describe("confirmation guard", () => {
  it("CONFIRMO sin pending → clarify sin capabilities", () => {
    const state = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
    const decision = decideTurn({
      interpretation: baseInterp(),
      state,
      message: "CONFIRMO",
    });
    assert.equal(decision.action, "clarify");
    assertNoWrites(decision);
    const reply = composeReplyDeterministic({
      decision,
      interpretation: baseInterp(),
      facts: [],
      capabilityResults: [],
      state: migrateV3ToVNext(state),
    });
    assert.equal(reply, NO_PENDING_CONFIRM_MESSAGE);
  });

  it("sí, confirmo sin pending → clarify", () => {
    const state = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
    const decision = decideTurn({
      interpretation: baseInterp({ normalizedMeaning: "Sí, confirmo" }),
      state,
      message: "sí, confirmo",
    });
    assert.equal(decision.action, "clarify");
    assertNoWrites(decision);
    const reply = composeReplyDeterministic({
      decision,
      interpretation: baseInterp(),
      facts: [],
      capabilityResults: [],
      state: migrateV3ToVNext(state),
    });
    assert.equal(reply, NO_PENDING_CONFIRM_MESSAGE);
  });

  it("confirmación duplicada → clarify", () => {
    const state = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
    state.activeTask = {
      type: "certificate",
      status: "completed",
      collected: {},
      missing: [],
    };
    const decision = decideTurn({
      interpretation: baseInterp(),
      state,
      message: "CONFIRMO",
    });
    assert.equal(decision.action, "clarify");
    assertNoWrites(decision);
    const reply = composeReplyDeterministic({
      decision,
      interpretation: baseInterp(),
      facts: [],
      capabilityResults: [],
      state: migrateV3ToVNext(state),
    });
    assert.equal(reply, DUPLICATE_CONFIRM_MESSAGE);
  });

  it("confirmación de operación cancelada → clarify stale", () => {
    const state = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
    state.activeTask = {
      type: "certificate",
      status: "cancelled",
      collected: {},
      missing: [],
    };
    const decision = decideTurn({
      interpretation: baseInterp(),
      state,
      message: "CONFIRMO",
    });
    assert.equal(decision.action, "clarify");
    assertNoWrites(decision);
    const reply = composeReplyDeterministic({
      decision,
      interpretation: baseInterp(),
      facts: [],
      capabilityResults: [],
      state: migrateV3ToVNext(state),
    });
    assert.equal(reply, STALE_CONFIRM_MESSAGE);
  });

  it("confirmación de versión anterior → clarify stale", () => {
    const state = pendingCertState();
    const decision = decideTurn({
      interpretation: baseInterp({
        confirmation: {
          intended: true,
          containsCorrections: false,
          targetOperationId: "op-old",
        },
      }),
      state,
      message: "CONFIRMO",
    });
    assert.equal(decision.action, "clarify");
    assertNoWrites(decision);
    const reply = composeReplyDeterministic({
      decision,
      interpretation: baseInterp(),
      facts: [],
      capabilityResults: [],
      state: migrateV3ToVNext(state),
    });
    assert.equal(reply, STALE_CONFIRM_MESSAGE);
  });

  it("pregunta qué pasa si confirmo sin pending", () => {
    const state = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
    const decision = decideTurn({
      interpretation: baseInterp({
        userAct: "question",
        relation: "standalone",
        normalizedMeaning: "Pregunta efecto de confirmar",
      }),
      state,
      message: "¿qué pasa si confirmo?",
    });
    assert.equal(decision.action, "clarify");
    assertNoWrites(decision);
    const reply = composeReplyDeterministic({
      decision,
      interpretation: baseInterp(),
      facts: [],
      capabilityResults: [],
      state: migrateV3ToVNext(state),
    });
    assert.equal(reply, NO_PENDING_CONFIRM_MESSAGE);
  });

  it("pregunta qué pasa si confirmo con pending informa", () => {
    const state = pendingCertState();
    const decision = decideTurn({
      interpretation: baseInterp({
        userAct: "question",
        relation: "standalone",
        normalizedMeaning: "Pregunta efecto de confirmar",
      }),
      state,
      message: "¿qué pasa si confirmo?",
    });
    assert.equal(decision.action, "clarify");
    assertNoWrites(decision);
    const reply = composeReplyDeterministic({
      decision,
      interpretation: baseInterp(),
      facts: [],
      capabilityResults: [],
      state: migrateV3ToVNext(state),
    });
    assert.ok(reply.includes("certificado"));
    assert.ok(reply.includes("CONFIRMO"));
  });

  it("confirmo pero con corrección no hace confirm_write", () => {
    const state = pendingCertState();
    const interp = baseInterp({
      userAct: "correction",
      relation: "confirm",
      corrections: [{ field: "date", value: "2026-01-15" }],
      confirmation: { intended: true, containsCorrections: true },
      normalizedMeaning: "Confirma pero corrige fecha",
    });
    const decision = decideTurn({
      interpretation: interp,
      state,
      message: "confirmo, pero con fecha 15/01",
    });
    assert.equal(decision.action, "execute");
    assert.notEqual(decision.action, "confirm_write");
    assert.equal(decision.authorizedCapabilities.length, 0);
    assert.equal(decision.suppliedFields?.date, "2026-01-15");
  });

  it("CONFIRMO con pending válido → confirm_write", () => {
    const state = pendingCertState();
    const decision = decideTurn({
      interpretation: baseInterp(),
      state,
      message: "CONFIRMO",
    });
    assert.equal(decision.action, "confirm_write");
    const filtered = filterAuthorizedCapabilities(decision);
    assert.ok(filtered.some((c) => c.name === "certificate.issue"));
  });
});
