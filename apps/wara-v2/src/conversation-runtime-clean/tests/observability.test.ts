import assert from "node:assert/strict";
import { it } from "node:test";
import { InMemoryCleanObservability } from "../adapters/observability/in-memory-observability.js";

const clock = { now: () => new Date("2026-08-17T12:00:00Z") };
it("stores sanitized stage traces with tenant isolation and contractual metrics", async () => {
  const obs = new InMemoryCleanObservability(clock); const { traceId } = obs.start({ tenantId: "secret-tenant", messageId: "m", runtimeVersion: "clean-1" });
  obs.record({ traceId, tenantId: "secret-tenant", stage: "policy", status: "blocked", latencyMs: 3, runtimeVersion: "clean-1", capabilityNames: ["ticket.create.commit"], writeAttempt: true });
  obs.record({ traceId, tenantId: "secret-tenant", stage: "execution", status: "failed", latencyMs: 4, runtimeVersion: "clean-1", resultStatuses: ["backend_error"], safeError: "service_unavailable" });
  const events = await obs.get(traceId, "secret-tenant"); assert.equal(events?.length, 2);
  assert.equal(JSON.stringify(events).includes("secret-tenant"), false);
  assert.equal(await obs.get(traceId, "other"), null);
  assert.equal(obs.metrics().policy_blocks, 1); assert.equal(obs.metrics().write_attempts, 1); assert.equal(obs.metrics().backend_errors, 1);
});

