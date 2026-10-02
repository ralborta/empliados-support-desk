import assert from "node:assert/strict";
import { it } from "node:test";
import { loadCleanRuntimeConfig } from "../config/clean-config.js";
import { VersionedKnowledgeRepository } from "../adapters/knowledge/versioned-knowledge-repository.js";
import type { KnowledgeDocument } from "../core/knowledge/contracts.js";

const enabled = loadCleanRuntimeConfig({ WARA_CLEAN_RUNTIME_ENABLED: "true", WARA_CLEAN_KB_ENABLED: "true" });
const docs: KnowledgeDocument[] = [
  { id: "topic", source: "global", version: "1", text: "global fact", scope: "global", humanValidated: true },
  { id: "topic", source: "tenant", version: "2", text: "tenant fact", scope: "tenant", tenantId: "a", humanValidated: true },
  { id: "topic", source: "draft", version: "9", text: "unvalidated", scope: "tenant", tenantId: "a", humanValidated: false },
];

it("retrieves only validated evidence visible to the tenant", async () => {
  const repo = new VersionedKnowledgeRepository(enabled, docs);
  const a = await repo.retrieve({ scope: { tenantId: "a", domain: "platform" }, topicId: "topic" });
  assert.equal(a.status, "found"); assert.deepEqual(a.passages.map((p) => p.text).sort(), ["global fact", "tenant fact"]);
  const b = await repo.retrieve({ scope: { tenantId: "b", domain: "platform" }, topicId: "topic" });
  assert.deepEqual(b.passages.map((p) => p.text), ["global fact"]);
});

it("is fail-closed and never turns evidence into a capability", async () => {
  const repo = new VersionedKnowledgeRepository(loadCleanRuntimeConfig({}), docs);
  assert.deepEqual(await repo.retrieve({ scope: { tenantId: "a", domain: "platform" }, topicId: "topic" }), { status: "not_found", passages: [] });
  assert.equal(JSON.stringify(docs).includes("capability"), false);
});
