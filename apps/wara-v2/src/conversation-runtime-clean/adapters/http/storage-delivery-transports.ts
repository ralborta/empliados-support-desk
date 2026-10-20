import type { AttachmentScanner, AttachmentScanResult, AttachmentStorageTransport } from "../attachments/guarded-storage-adapter.js";
import type { AttachmentTarget } from "../../core/attachments/contracts.js";
import type { OutboxDeliveryDispatcher, DeliveryResult } from "../outbox/guarded-outbox-worker.js";
import type { OutboxEvent } from "../../core/outbox/contracts.js";

async function post(url: string, token: string | null, body: unknown): Promise<Response> { return fetch(url, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) }); }
export class HttpAttachmentScanner implements AttachmentScanner {
  constructor(private readonly url: string | null) {}
  configured(): boolean { return Boolean(this.url); }
  async scan(input: { tenantId: string; sourceHandle: string; checksum: string; mimeType: string; sizeBytes: number }): Promise<AttachmentScanResult> {
    if (!this.url) return { status: "unavailable" }; const response = await post(this.url, null, input); if (!response.ok) return { status: "unavailable" };
    const value = await response.json() as { status?: unknown; reason?: unknown }; return value.status === "clean" ? { status: "clean" } : value.status === "rejected" ? { status: "rejected", reason: typeof value.reason === "string" ? value.reason : "rejected" } : { status: "unavailable" };
  }
}
export class HttpAttachmentStorage implements AttachmentStorageTransport {
  constructor(private readonly url: string | null) {}
  async put(input: { tenantId: string; attachmentId: string; sourceHandle: string; checksum: string; mimeType: string; sizeBytes: number; correlationId: string }): Promise<void> { if (!this.url || !(await post(`${this.url}/put`, null, input)).ok) throw new Error("storage_unavailable"); }
  async link(input: { tenantId: string; attachmentId: string; target: AttachmentTarget; correlationId: string }): Promise<void> { if (!this.url || !(await post(`${this.url}/link`, null, input)).ok) throw new Error("storage_unavailable"); }
}
export class HttpOutboxDeliveryDispatcher implements OutboxDeliveryDispatcher {
  constructor(private readonly url: string | null, private readonly token: string | null) {}
  async deliver(event: OutboxEvent): Promise<DeliveryResult> {
    if (!this.url || !this.token) return { status: "permanent_failure" }; const response = await post(this.url, this.token, event);
    if (response.ok) return { status: "delivered" }; if (response.status >= 500) return { status: "retryable_failure", retryAt: new Date(Date.now() + 30_000).toISOString() }; return { status: "permanent_failure" };
  }
}
