import assert from "node:assert/strict";
import { it } from "node:test";
import { loadCleanRuntimeConfig } from "../config/clean-config.js";
import { GuardedAttachmentStorageAdapter } from "../adapters/attachments/guarded-storage-adapter.js";

const validation = { allowedMimeTypes: new Set(["image/jpeg"]), maxSizeBytes: 1000 };
const metadata = { tenantId: "tenant-a", conversationId: "c", messageId: "m", filename: "proof.jpg", mimeType: "image/jpeg", sizeBytes: 10, checksum: "1234567890abcdef", idempotencyKey: "idk", target: null };
const tenant = { tenantId: "tenant-a", allowed: true } as const;
const binding = { operationId: "op", version: 1, payloadHash: "hash", idempotencyKey: "key" };

it("blocks storage when scanner or write gate is unavailable", async () => {
  let puts = 0;
  const adapter = new GuardedAttachmentStorageAdapter(loadCleanRuntimeConfig({ WARA_CLEAN_RUNTIME_ENABLED: "true" }), validation, { configured: () => false, scan: async () => ({ status: "unavailable" }) }, { put: async () => { puts++; }, link: async () => {} });
  const prepared = await adapter.prepare(metadata); assert.equal(prepared.status, "success");
  const attachmentId = prepared.status === "success" ? prepared.data.id : "";
  const result = await adapter.commit({ ...binding, attachmentId, target: null, tenant, correlationId: "corr", authorized: true, binding, pendingBinding: binding, sourceHandle: "opaque" });
  assert.equal(result.status, "rejected"); assert.equal(puts, 0);
});

it("validates metadata, scans, stores idempotently and preserves tenant isolation", async () => {
  let puts = 0;
  const config = loadCleanRuntimeConfig({ WARA_CLEAN_RUNTIME_ENABLED: "true", WARA_CLEAN_EXTERNAL_READS_ENABLED: "true", WARA_CLEAN_EXTERNAL_WRITES_ENABLED: "true" });
  const adapter = new GuardedAttachmentStorageAdapter(config, validation, { configured: () => true, scan: async () => ({ status: "clean" }) }, { put: async () => { puts++; }, link: async () => {} });
  assert.equal((await adapter.prepare({ ...metadata, mimeType: "text/html" })).status, "validation_error");
  const one = await adapter.prepare(metadata); const two = await adapter.prepare(metadata);
  assert.equal(one.status, "success"); assert.equal(two.status, "success");
  const attachmentId = one.status === "success" ? one.data.id : "";
  assert.equal((await adapter.commit({ ...binding, attachmentId, target: null, tenant: { tenantId: "tenant-b", allowed: true }, correlationId: "c", authorized: true, binding, pendingBinding: binding, sourceHandle: "opaque" })).status, "not_found");
  assert.equal((await adapter.commit({ ...binding, attachmentId, target: null, tenant, correlationId: "c", authorized: true, binding, pendingBinding: binding, sourceHandle: "opaque" })).status, "success");
  assert.equal(puts, 1);
});

