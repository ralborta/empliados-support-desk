import type { CleanRuntimeConfig } from "../../config/clean-config.js";
import { validateAttachment, type AttachmentCommitInput, type AttachmentDescriptor, type AttachmentPrepareInput, type AttachmentTarget, type AttachmentValidationConfig } from "../../core/attachments/contracts.js";
import type { NormalizedServiceResult } from "../services/normalized-service-result.js";
import type { CommitBinding } from "../services/operational-service-contracts.js";
import type { TenantPermission } from "../services/guarded-http-transport.js";

export type AttachmentScanResult = Readonly<{ status: "clean" } | { status: "rejected"; reason: string } | { status: "unavailable" }>;
export interface AttachmentScanner { configured(): boolean; scan(input: Readonly<{ tenantId: string; sourceHandle: string; checksum: string; mimeType: string; sizeBytes: number }>): Promise<AttachmentScanResult>; }
export interface AttachmentStorageTransport {
  put(input: Readonly<{ tenantId: string; attachmentId: string; sourceHandle: string; checksum: string; mimeType: string; sizeBytes: number; correlationId: string }>): Promise<void>;
  link(input: Readonly<{ tenantId: string; attachmentId: string; target: AttachmentTarget; correlationId: string }>): Promise<void>;
}
type CommitContext = Readonly<{ tenant: TenantPermission; correlationId: string; authorized: boolean; binding: CommitBinding; pendingBinding?: CommitBinding }>;
function bound(a: CommitBinding, b: CommitBinding | undefined): boolean { return Boolean(b && a.operationId === b.operationId && a.version === b.version && a.payloadHash === b.payloadHash && a.idempotencyKey === b.idempotencyKey); }

export class GuardedAttachmentStorageAdapter {
  private readonly records = new Map<string, AttachmentDescriptor>();
  private readonly idempotency = new Map<string, string>();
  constructor(private readonly config: CleanRuntimeConfig, private readonly validation: AttachmentValidationConfig, private readonly scanner: AttachmentScanner, private readonly storage: AttachmentStorageTransport) {}

  async prepare(input: AttachmentPrepareInput): Promise<NormalizedServiceResult<AttachmentDescriptor>> {
    const errors = validateAttachment(input, this.validation);
    if (errors.length) return { status: "validation_error", errors };
    const existing = this.idempotency.get(`${input.tenantId}:${input.idempotencyKey}`);
    if (existing) return { status: "success", data: this.records.get(existing)!, facts: [] };
    const id = `attachment-${input.checksum.slice(0, 16)}-${this.records.size + 1}`;
    const descriptor: AttachmentDescriptor = { ...input, id, status: "pending" };
    this.records.set(id, descriptor); this.idempotency.set(`${input.tenantId}:${input.idempotencyKey}`, id);
    return { status: "success", data: descriptor, facts: [] };
  }

  async commit(input: CommitContext & AttachmentCommitInput & Readonly<{ sourceHandle: string }>): Promise<NormalizedServiceResult<AttachmentDescriptor>> {
    const record = this.records.get(input.attachmentId);
    if (!record || record.tenantId !== input.tenant.tenantId) return { status: "not_found", facts: [] };
    if (!this.config.runtimeEnabled || !this.config.externalWritesEnabled || !input.tenant.allowed || !input.authorized || !bound(input.binding, input.pendingBinding)) return { status: "rejected", code: "external_writes_blocked", facts: [] };
    if (!this.scanner.configured()) return { status: "rejected", code: "scanner_unavailable", facts: [] };
    const scan = await this.scanner.scan({ tenantId: record.tenantId, sourceHandle: input.sourceHandle, checksum: record.checksum, mimeType: record.mimeType, sizeBytes: record.sizeBytes });
    if (scan.status !== "clean") return { status: "rejected", code: scan.status === "unavailable" ? "scanner_unavailable" : "attachment_rejected", facts: [] };
    try {
      await this.storage.put({ tenantId: record.tenantId, attachmentId: record.id, sourceHandle: input.sourceHandle, checksum: record.checksum, mimeType: record.mimeType, sizeBytes: record.sizeBytes, correlationId: input.correlationId });
      const next: AttachmentDescriptor = { ...record, target: input.target, status: input.target ? "linked" : "uploaded" };
      this.records.set(next.id, next); return { status: "success", data: next, facts: [] };
    } catch { return { status: "backend_error", safeError: "storage_unavailable" }; }
  }

  async link(input: CommitContext & Readonly<{ attachmentId: string; target: AttachmentTarget }>): Promise<NormalizedServiceResult<AttachmentDescriptor>> {
    const record = this.records.get(input.attachmentId);
    if (!record || record.tenantId !== input.tenant.tenantId) return { status: "not_found", facts: [] };
    if (!this.config.externalWritesEnabled || !input.tenant.allowed || !input.authorized || !bound(input.binding, input.pendingBinding)) return { status: "rejected", code: "external_writes_blocked", facts: [] };
    if (record.status !== "uploaded") return { status: "conflict", code: "attachment_not_uploaded", facts: [] };
    try { await this.storage.link({ tenantId: record.tenantId, attachmentId: record.id, target: input.target, correlationId: input.correlationId }); }
    catch { return { status: "backend_error", safeError: "storage_unavailable" }; }
    const next: AttachmentDescriptor = { ...record, target: input.target, status: "linked" }; this.records.set(next.id, next);
    return { status: "success", data: next, facts: [] };
  }
}

