import type { NormalizedServiceResult } from "./normalized-service-result.js";
import { normalizeServiceResponse } from "./normalized-service-result.js";
import type { CleanRuntimeConfig } from "../../config/clean-config.js";
import type { CommitBinding } from "./operational-service-contracts.js";

export type TenantPermission = Readonly<{ tenantId: string; allowed: boolean }>;
export type GuardedRequest = Readonly<{
  capability: string; kind: "read" | "write"; tenant: TenantPermission; correlationId: string;
  path: string; body?: Readonly<Record<string, unknown>>; authorized: boolean;
  binding?: CommitBinding; pendingBinding?: CommitBinding;
}>;
export type SingleRequestTransport = (input: Readonly<{ path: string; body?: Readonly<Record<string, unknown>>; correlationId: string; tenantId: string; timeoutMs: number }>) => Promise<unknown>;

function sameBinding(a: CommitBinding | undefined, b: CommitBinding | undefined): boolean {
  return Boolean(a && b && a.operationId === b.operationId && a.version === b.version && a.payloadHash === b.payloadHash && a.idempotencyKey === b.idempotencyKey);
}

export class GuardedHttpTransport {
  constructor(private readonly config: CleanRuntimeConfig, private readonly transport: SingleRequestTransport, private readonly timeoutMs = 10_000) {}
  async execute<T>(request: GuardedRequest): Promise<NormalizedServiceResult<T>> {
    if (!this.config.runtimeEnabled || !request.tenant.allowed || !request.authorized) return { status: "unauthorized", facts: [] };
    if (request.kind === "read" && !this.config.externalReadsEnabled) return { status: "rejected", code: "external_reads_disabled", facts: [] };
    if (request.kind === "write" && (!this.config.externalWritesEnabled || !sameBinding(request.binding, request.pendingBinding))) {
      return { status: "rejected", code: "external_writes_blocked", facts: [] };
    }
    try {
      const raw = await this.transport({ path: request.path, body: request.body, correlationId: request.correlationId, tenantId: request.tenant.tenantId, timeoutMs: this.timeoutMs });
      return normalizeServiceResponse<T>(raw);
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      return name === "AbortError" || name === "TimeoutError" ? { status: "timeout", safeError: "service_timeout" } : { status: "backend_error", safeError: "service_unavailable" };
    }
  }
}
