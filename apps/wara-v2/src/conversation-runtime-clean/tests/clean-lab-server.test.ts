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

it("exposes a transport-only WhatsApp adapter with isolated auth and stable phone session", async () => {
  const health = sanitizedCleanHealthConfig(loadCleanRuntimeConfig({ WARA_CLEAN_RUNTIME_ENABLED: "true" }));
  const received: Array<{ tenantId: string; sessionId: string; messageId: string; message: string; phone?: string | null }> = [];
  const server = await startCleanLabServer({ host: "127.0.0.1", port: 0, apiKey: "lab-key", allowedTenants: new Set(["lab"]), requestsPerMinute: 10, commit: "sha", health, persistence: "in_memory", kb: "disabled", whatsapp: { apiKey: "channel-key", tenantId: "lab" } }, { turn: async (input) => { received.push(input); return response; } }, { get: async () => null });
  try {
    const denied = await fetch(`${server.baseUrl}/api/whatsapp/turn`, { method: "POST", headers: { "x-api-key": "lab-key", "content-type": "application/json" }, body: JSON.stringify({ phone: "+5491133788190", body: "hola" }) });
    assert.equal(denied.status, 401);
    const send = (body: Record<string, unknown>) => fetch(`${server.baseUrl}/api/whatsapp/turn`, { method: "POST", headers: { "x-api-key": "channel-key", "content-type": "application/json" }, body: JSON.stringify(body) });
    const first = await send({ phone: "+5491133788190", body: "hola", messageId: "wamid-1" });
    assert.equal(first.status, 200); const value = await first.json() as { engine: string; message: string; skipResponse_s: string; writes: { executed: boolean } };
    assert.deepEqual(value, { engine: "wara-clean", message: "Hola", skipResponse_s: "false", writes: { attempted: false, executed: false }, ok: true, ok_s: "true", summaryText: "Hola", flowComplete_s: "true", nextFlow: "", nextFlow_s: "", replay: false, traceId: "trace-1" });
    await send({ from: "+5491133788190", message: "hola de nuevo", id: "wamid-2" });
    assert.equal(received[0]?.tenantId, "lab"); assert.equal(received[0]?.phone, "+5491133788190"); assert.equal(received[0]?.messageId, "wamid-1");
    assert.equal(received[0]?.sessionId, received[1]?.sessionId); assert.equal(received[0]?.sessionId.includes("5491133788190"), false);
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
