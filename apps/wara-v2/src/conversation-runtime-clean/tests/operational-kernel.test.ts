import assert from "node:assert/strict";
import test from "node:test";
import { companySelect, operationCancel, operationConfirm, operationCorrect, operationPrepare, unitSelect } from "../core/kernel/operational-kernel.js";

const pending = { operationId: "op", capability: "odometer.update", taskId: "task", version: 2, payloadHash: "hash", idempotencyKey: "idem", preparedArguments: { value: 100 }, status: "awaiting_confirmation" as const };

test("company.select and unit.select consume typed resolution results", () => {
  const company = companySelect({ requestId: "r", status: "resolved", entity: { entityType: "company", company: { id: "c", name: "C" } }, facts: [] });
  const unit = unitSelect({ requestId: "r", status: "resolved", entity: { entityType: "unit", unit: { id: "u", label: "U", companyId: "c" } }, facts: [] });
  assert.equal(company.status === "resolved" && company.value.id, "c");
  assert.equal(unit.status === "resolved" && unit.value.id, "u");
});
test("selection preserves not_found, ambiguous, invalid and backend_error", () => {
  assert.equal(companySelect({ requestId: "r", status: "not_found", facts: [] }).status, "not_found");
  assert.equal(companySelect({ requestId: "r", status: "ambiguous", candidates: [], facts: [] }).status, "ambiguous");
  assert.equal(companySelect({ requestId: "r", status: "invalid", errors: ["x"] }).status, "invalid");
  assert.equal(companySelect({ requestId: "r", status: "backend_error", safeError: "unavailable" }).status, "backend_error");
});
test("operation.prepare validates and creates a bound pending operation", () => {
  const result = operationPrepare({ operationId: "op", capability: "odometer.update", taskId: "task", version: 2, payloadHash: "hash", idempotencyKey: "idem", arguments: { value: 100 } });
  assert.equal(result.status, "resolved");
  if (result.status === "resolved") assert.deepEqual(result.value, pending);
  assert.equal(operationPrepare({ operationId: "", capability: "", taskId: "", version: 0, payloadHash: "", idempotencyKey: "", arguments: {} }).status, "invalid");
});
test("operation.correct invalidates pending binding", () => {
  const result = operationCorrect({ pending, corrections: { value: 120 } });
  assert.equal(result.status, "resolved");
  if (result.status === "resolved") { assert.equal(result.value.pendingOperation, null); assert.equal(result.value.preparedArguments.value, 120); }
});
test("operation.confirm requires complete binding match", () => {
  assert.equal(operationConfirm({ pending, binding: { operationId: "op", capability: "odometer.update", taskId: "task", version: 2, payloadHash: "hash", idempotencyKey: "idem" } }).status, "resolved");
  assert.equal(operationConfirm({ pending, binding: { operationId: "other", capability: "odometer.update", taskId: "task", version: 2, payloadHash: "hash", idempotencyKey: "idem" } }).status, "invalid");
});
test("operation.cancel distinguishes present and absent pending", () => {
  assert.equal(operationCancel({ pending }).status, "resolved");
  assert.equal(operationCancel({ pending: null }).status, "not_found");
});
