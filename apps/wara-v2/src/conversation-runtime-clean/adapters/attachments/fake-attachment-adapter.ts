import type { AttachmentAdapter, AttachmentCommitInput, AttachmentDescriptor, AttachmentPrepareInput, AttachmentValidationConfig } from "../../core/attachments/contracts.js";
import { validateAttachment } from "../../core/attachments/contracts.js";
import type { NormalizedServiceResult } from "../services/normalized-service-result.js";

export class FakeAttachmentAdapter implements AttachmentAdapter {
  private readonly records = new Map<string, AttachmentDescriptor>();
  private readonly idempotency = new Map<string, string>();
  constructor(private readonly config: AttachmentValidationConfig) {}
  async prepare(input: AttachmentPrepareInput): Promise<NormalizedServiceResult<AttachmentDescriptor>> {
    const errors = validateAttachment(input, this.config);
    if (errors.length) return { status: "validation_error", errors };
    const existingId = this.idempotency.get(input.idempotencyKey);
    if (existingId) return { status: "success", data: this.records.get(existingId)!, facts: [] };
    const record: AttachmentDescriptor = { ...input, id: `fake-attachment-${this.records.size + 1}`, status: "pending" };
    this.records.set(record.id, record); this.idempotency.set(input.idempotencyKey, record.id);
    return { status: "success", data: record, facts: [] };
  }
  async commit(input: AttachmentCommitInput): Promise<NormalizedServiceResult<AttachmentDescriptor>> {
    return this.transition(input, input.target ? "linked" : "uploaded");
  }
  async get(input: Readonly<{ tenantId: string; attachmentId: string }>): Promise<NormalizedServiceResult<AttachmentDescriptor>> {
    const record = this.records.get(input.attachmentId);
    return record?.tenantId === input.tenantId ? { status: "success", data: record, facts: [] } : { status: "not_found", facts: [] };
  }
  async link(input: AttachmentCommitInput & Readonly<{ target: NonNullable<AttachmentDescriptor["target"]> }>): Promise<NormalizedServiceResult<AttachmentDescriptor>> {
    return this.transition(input, "linked");
  }
  private async transition(input: AttachmentCommitInput, status: "uploaded" | "linked"): Promise<NormalizedServiceResult<AttachmentDescriptor>> {
    const current = this.records.get(input.attachmentId);
    if (!current) return { status: "not_found", facts: [] };
    if (current.status === "linked" && JSON.stringify(current.target) !== JSON.stringify(input.target)) return { status: "conflict", code: "attachment_already_linked", facts: [] };
    const next: AttachmentDescriptor = { ...current, target: input.target, status };
    this.records.set(next.id, next); return { status: "success", data: next, facts: [] };
  }
}
