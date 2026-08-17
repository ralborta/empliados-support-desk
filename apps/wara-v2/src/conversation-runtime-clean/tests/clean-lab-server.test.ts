import assert from "node:assert/strict";
import { it } from "node:test";
import { startCleanLabServer } from "../adapters/lab/clean-lab-server.js";
import { loadCleanRuntimeConfig, sanitizedCleanHealthConfig } from "../config/clean-config.js";
import { createEmptyCleanState } from "../core/types/state.js";
import { CleanRuntimeError } from "../core/errors/runtime-errors.js";

const state = createEmptyCleanState({ tenantId: "lab", conversationId: "session" });
const response = { reply: "Hola", state, responsePlan: { purpose: "greet" as const, facts: [], nextQuestion: null, pendingTaskReminder: null, protectedBlocks: [] }, trace: { runtime: "clean" as const, traceId: "trace-1", decision: null, policy: null, resolutionCount: 0, authorizedOperationIds: [], executionCount: 0, writeAttempt: false, writeExecuted: false, invariantViolations: [] }, replay: false, traceId: "trace-1" };

it("exposes isolated authenticated lab turn health trace and rate limit", async () => {
  const health = sanitizedCleanHealthConfig(loadCleanRuntimeConfig({ WARA_CLEAN_RUNTIME_ENABLED: "true" }));
  const server = await startCleanLabServer({ host: "127.0.0.1", port: 0, apiKey: "test-key", allowedTenants: new Set(["lab"]), requestsPerMinute: 1, commit: "sha", health, persistence: "in_memory", kb: "disabled" }, { turn: async () => response }, { get: async (id, tenant) => id === "trace-1" && tenant === "lab" ? { traceId: id, safe: true } : null });
  try {
    const publicHealth = await fetch(`${server.baseUrl}/api/wara-clean-lab/health`); assert.equal(publicHealth.status, 200); assert.equal((await publicHealth.json() as { deliveryEnabled: boolean }).deliveryEnabled, false);
    const unauthenticated = await fetch(`${server.baseUrl}/api/wara-clean-lab/turn`, { method: "POST" }); assert.equal(unauthenticated.status, 401);
    const unauthenticatedBody = await unauthenticated.json() as { error: { code: string; traceId: string; retryable: boolean } }; assert.equal(unauthenticatedBody.error.code, "UNAUTHENTICATED"); assert.ok(unauthenticatedBody.error.traceId); assert.equal(unauthenticatedBody.error.retryable, false);
    const headers = { authorization: "Bearer test-key", "content-type": "application/json" };
    const payload = JSON.stringify({ tenantId: "lab", sessionId: "session", messageId: "m1", message: "hola" });
    const turn = await fetch(`${server.baseUrl}/api/wara-clean-lab/turn`, { method: "POST", headers, body: payload }); assert.equal(turn.status, 200);
    const value = await turn.json() as { runtime: string; replay: boolean; writes: { executed: boolean }; traceId: string }; assert.equal(value.runtime, "clean"); assert.equal(value.replay, false); assert.equal(value.writes.executed, false); assert.equal(value.traceId, "trace-1");
    assert.equal((await fetch(`${server.baseUrl}/api/wara-clean-lab/turn`, { method: "POST", headers, body: payload })).status, 429);
    assert.equal((await fetch(`${server.baseUrl}/api/wara-clean-lab/trace/trace-1?tenantId=lab`, { headers: { authorization: "Bearer test-key" } })).status, 200);
  } finally { await server.close(); }
});

for (const scenario of [
  { code: "OPTIMISTIC_CONFLICT" as const, status: 409, retryable: true },
  { code: "PERSISTENCE_UNAVAILABLE" as const, status: 503, retryable: true },
  { code: "STATE_INVARIANT_VIOLATION" as const, status: 500, retryable: false },
  { code: "INTERNAL_ERROR" as const, status: 500, retryable: false },
]) it(`returns sanitized ${scenario.code} with trace identity`, async () => {
  const health = sanitizedCleanHealthConfig(loadCleanRuntimeConfig({ WARA_CLEAN_RUNTIME_ENABLED: "true" }));
  const server = await startCleanLabServer({ host: "127.0.0.1", port: 0, apiKey: "key", allowedTenants: new Set(["lab"]), requestsPerMinute: 10, commit: "sha", health, persistence: "configured", kb: "disabled" }, { turn: async () => { throw new CleanRuntimeError(scenario.code, "safe-trace", "DUPLICATE_TASK_ID", { cause: new Error("secret sql payload") }); } }, { get: async () => null });
  try {
    const result = await fetch(`${server.baseUrl}/api/wara-clean-lab/turn`, { method: "POST", headers: { authorization: "Bearer key", "content-type": "application/json" }, body: JSON.stringify({ tenantId: "lab", sessionId: "session", messageId: "message", message: "opaque" }) });
    assert.equal(result.status, scenario.status); const body = await result.json() as { error: { code: string; traceId: string; retryable: boolean } };
    assert.deepEqual(body, { error: { code: scenario.code, traceId: "safe-trace", retryable: scenario.retryable } }); assert.equal(JSON.stringify(body).includes("secret"), false); assert.equal(JSON.stringify(body).includes("DUPLICATE_TASK_ID"), false);
  } finally { await server.close(); }
});
