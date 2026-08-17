import assert from "node:assert/strict";
import test from "node:test";
import { createEmptyCleanState } from "../core/types/state.js";
import { validateStateInvariants } from "../core/state/invariants.js";

test("accepts an empty native state", () => {
  assert.deepEqual(validateStateInvariants(createEmptyCleanState({ tenantId: "t", conversationId: "c" })), []);
});

test("detects dominant expectation XOR", () => {
  const state = createEmptyCleanState({ tenantId: "t", conversationId: "c" });
  const invalid = { ...state, expectedInput: { field: "unit" as const, taskId: null, purpose: "unit" }, pendingClarification: { reason: "x", question: "?", taskId: null } };
  assert.equal(validateStateInvariants(invalid).some((violation) => violation.code === "EXPECTATION_XOR"), true);
});

test("detects incomplete pending binding and invalid task", () => {
  const state = createEmptyCleanState({ tenantId: "t", conversationId: "c" });
  const invalid = { ...state, pendingOperation: { operationId: "", capability: "", taskId: "missing", version: 0, payloadHash: "", idempotencyKey: "", preparedArguments: {}, status: "prepared" as const } };
  const codes = validateStateInvariants(invalid).map((violation) => violation.code);
  assert.equal(codes.includes("INVALID_OPERATION_TASK"), true);
  assert.equal(codes.includes("INVALID_PENDING_OPERATION"), true);
});
