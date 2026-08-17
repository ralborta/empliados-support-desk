import assert from "node:assert/strict";
import test from "node:test";
import { normalizeServiceResponse } from "../adapters/services/normalized-service-result.js";
import { V1_SERVICE_RESPONSE_FIXTURES as fixtures } from "./fixtures/v1-service-responses.js";

test("normalizes every supported technical result deterministically", () => {
  assert.equal(normalizeServiceResponse(fixtures.odooCreated).status, "success");
  assert.equal(normalizeServiceResponse(fixtures.accepted).status, "pending");
  assert.equal(normalizeServiceResponse(fixtures.missing).status, "not_found");
  assert.equal(normalizeServiceResponse(fixtures.rejected).status, "rejected");
  assert.equal(normalizeServiceResponse(fixtures.conflict).status, "conflict");
  assert.equal(normalizeServiceResponse(fixtures.unauthorized).status, "unauthorized");
  assert.equal(normalizeServiceResponse(fixtures.invalid).status, "validation_error");
  assert.equal(normalizeServiceResponse(fixtures.unavailable).status, "backend_error");
  assert.equal(normalizeServiceResponse(fixtures.timeout).status, "timeout");
});
test("unknown and malformed responses are blocked and never assumed successful", () => {
  assert.deepEqual(normalizeServiceResponse(fixtures.unknown), { status: "backend_error", safeError: "unknown_backend_response" });
  assert.deepEqual(normalizeServiceResponse("ok"), { status: "backend_error", safeError: "invalid_backend_response" });
  assert.deepEqual(normalizeServiceResponse({ ok: true }), { status: "backend_error", safeError: "missing_success_data" });
});
test("only response-backed fields become verified operational facts", () => {
  const result = normalizeServiceResponse(fixtures.odooCreated);
  assert.equal(result.status, "success");
  if (result.status === "success") {
    assert.ok(result.facts.every((fact) => fact.verified && fact.source === "capability"));
    assert.deepEqual(result.facts.map((fact) => fact.code), ["service.reference", "ticket.id"]);
  }
  const rejected = normalizeServiceResponse(fixtures.rejected);
  assert.equal("facts" in rejected && rejected.facts.length, 0);
});
