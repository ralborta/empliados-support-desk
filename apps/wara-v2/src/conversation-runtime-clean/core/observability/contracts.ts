export type CleanTraceStage = "input_metadata" | "interpretation" | "decision" | "policy" | "resolution" | "authorization" | "execution" | "state_transition" | "response_plan" | "composer_validation" | "persistence";
export type CleanTraceStatus = "ok" | "blocked" | "failed" | "duplicate" | "fallback";
export type CleanTraceEvent = Readonly<{
  traceId: string; stage: CleanTraceStage; status: CleanTraceStatus; at: string; latencyMs: number;
  messageId?: string; tenantRef: string; runtimeVersion: string; model?: string | null; promptVersion?: string | null;
  capabilityNames?: readonly string[]; resultStatuses?: readonly string[]; writeAttempt?: boolean; writeExecuted?: boolean;
  retries?: number; persistenceVersion?: number; safeError?: string;
}>;
export interface CleanTraceObserver {
  start(input: Readonly<{ tenantId: string; messageId?: string; runtimeVersion: string; model?: string | null; promptVersion?: string | null }>): Readonly<{ traceId: string }>;
  record(input: Omit<CleanTraceEvent, "tenantRef" | "at"> & Readonly<{ tenantId: string }>): void;
}
export type CleanMetricName = "interpretation_failures" | "policy_blocks" | "resolution_outcomes" | "capability_latency" | "backend_errors" | "composer_fallback" | "duplicate_messages" | "write_attempts" | "state_conflicts";
