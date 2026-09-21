import type { NormalizedServiceResult } from "../../adapters/services/normalized-service-result.js";
import type { CommitBinding } from "../../adapters/services/operational-service-contracts.js";

export type AttachmentStatus = "pending" | "uploaded" | "linked" | "rejected" | "failed";
export type AttachmentTarget = Readonly<{ type: "ticket" | "maintenance"; id: string }>;
export type AttachmentDescriptor = Readonly<{
  id: string; tenantId: string; conversationId: string; messageId: string; filename: string;
  mimeType: string; sizeBytes: number; checksum: string; idempotencyKey: string;
  target: AttachmentTarget | null; status: AttachmentStatus;
}>;
export type AttachmentPrepareInput = Omit<AttachmentDescriptor, "id" | "status">;
export type AttachmentCommitInput = CommitBinding & Readonly<{ attachmentId: string; target: AttachmentTarget | null }>;
export type AttachmentValidationConfig = Readonly<{ allowedMimeTypes: ReadonlySet<string>; maxSizeBytes: number }>;

export interface AttachmentAdapter {
  prepare(input: AttachmentPrepareInput): Promise<NormalizedServiceResult<AttachmentDescriptor>>;
  commit(input: AttachmentCommitInput): Promise<NormalizedServiceResult<AttachmentDescriptor>>;
  get(input: Readonly<{ tenantId: string; attachmentId: string }>): Promise<NormalizedServiceResult<AttachmentDescriptor>>;
  link(input: AttachmentCommitInput & Readonly<{ target: AttachmentTarget }>): Promise<NormalizedServiceResult<AttachmentDescriptor>>;
}

export function validateAttachment(input: AttachmentPrepareInput, config: AttachmentValidationConfig): readonly string[] {
  const errors: string[] = [];
  if (!input.tenantId || !input.conversationId || !input.messageId || !input.filename || !input.checksum || !input.idempotencyKey) errors.push("missing_metadata");
  if (!Number.isInteger(input.sizeBytes) || input.sizeBytes <= 0) errors.push("invalid_size");
  if (input.sizeBytes > config.maxSizeBytes) errors.push("size_exceeded");
  if (!config.allowedMimeTypes.has(input.mimeType)) errors.push("unsupported_type");
  return errors;
}
