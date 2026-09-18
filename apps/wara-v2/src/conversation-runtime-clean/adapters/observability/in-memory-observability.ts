import { createHash, randomUUID } from "node:crypto";
import type { Clock } from "../../core/persistence/contracts.js";
import type { CleanMetricName, CleanTraceEvent, CleanTraceObserver } from "../../core/observability/contracts.js";

function tenantRef(tenantId: string): string { return createHash("sha256").update(tenantId).digest("hex").slice(0, 16); }
function safeError(value: string | undefined): string | undefined { return value && value.length <= 100 && [...value].every((char) => char !== "\n" && char !== "\r") ? value : undefined; }

export class InMemoryCleanObservability implements CleanTraceObserver {
  private readonly events = new Map<string, CleanTraceEvent[]>();
  private readonly traceTenants = new Map<string, string>();
  private readonly counters = new Map<CleanMetricName, number>();
  constructor(private readonly clock: Clock) {}
  start(input: { tenantId: string; messageId?: string; runtimeVersion: string; model?: string | null; promptVersion?: string | null }): Readonly<{ traceId: string }> {
    const traceId = randomUUID(); this.traceTenants.set(traceId, tenantRef(input.tenantId)); this.events.set(traceId, []); return { traceId };
  }
  record(input: Omit<CleanTraceEvent, "tenantRef" | "at"> & { tenantId: string }): void {
    if (this.traceTenants.get(input.traceId) !== tenantRef(input.tenantId)) throw new Error("TRACE_TENANT_MISMATCH");
    const { tenantId, ...sanitized } = input;
    const event: CleanTraceEvent = Object.freeze({ ...sanitized, tenantRef: tenantRef(tenantId), at: this.clock.now().toISOString(), ...(safeError(input.safeError) ? { safeError: safeError(input.safeError) } : {}) });
    this.events.get(input.traceId)?.push(event);
    if (input.stage === "interpretation" && input.status === "failed") this.increment("interpretation_failures");
    if (input.stage === "policy" && input.status === "blocked") this.increment("policy_blocks");
    if (input.stage === "resolution") this.increment("resolution_outcomes");
    if (input.stage === "execution") this.increment("capability_latency");
    if (input.resultStatuses?.some((status) => status === "backend_error")) this.increment("backend_errors");
    if (input.stage === "composer_validation" && input.status === "fallback") this.increment("composer_fallback");
    if (input.status === "duplicate") this.increment("duplicate_messages");
    if (input.writeAttempt) this.increment("write_attempts");
    if (input.safeError === "optimistic_conflict") this.increment("state_conflicts");
  }
  private increment(name: CleanMetricName): void { this.counters.set(name, (this.counters.get(name) ?? 0) + 1); }
  async get(traceId: string, tenantId: string): Promise<readonly CleanTraceEvent[] | null> { return this.traceTenants.get(traceId) === tenantRef(tenantId) ? structuredClone(this.events.get(traceId) ?? []) : null; }
  metrics(): Readonly<Record<CleanMetricName, number>> { return Object.freeze({ interpretation_failures: 0, policy_blocks: 0, resolution_outcomes: 0, capability_latency: 0, backend_errors: 0, composer_fallback: 0, duplicate_messages: 0, write_attempts: 0, state_conflicts: 0, ...Object.fromEntries(this.counters) }); }
}
