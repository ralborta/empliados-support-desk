import assert from "node:assert/strict";
import test from "node:test";
import { cleanChildId, cleanDecisionId } from "../core/identity/stable-id.js";
import { cleanLiveMessageId } from "../live/corpus-identity.js";
import { CLEAN_LIVE_SYNTHETIC_CORPUS } from "../live/synthetic-corpus.js";

test("decision identity is stable for retries and opaque", () => {
  const input = { tenantId: "tenant-secret", conversationId: "conversation-secret", messageId: "message-secret" };
  const first = cleanDecisionId(input); const retry = cleanDecisionId(input);
  assert.equal(first, retry); assert.match(first, /^clean-decision-[a-f0-9]{32}$/);
  for (const sensitive of Object.values(input)) assert.equal(first.includes(sensitive), false);
});

test("identity separates messages conversations tenants and child ordinals", () => {
  const base = { tenantId: "tenant-a", conversationId: "conversation-a", messageId: "message-a" };
  const decision = cleanDecisionId(base);
  assert.notEqual(decision, cleanDecisionId({ ...base, messageId: "message-b" }));
  assert.notEqual(decision, cleanDecisionId({ ...base, conversationId: "conversation-b" }));
  assert.notEqual(decision, cleanDecisionId({ ...base, tenantId: "tenant-b" }));
  assert.notEqual(cleanChildId({ decisionId: decision, kind: "task", discriminator: "gps", ordinal: 0 }), cleanChildId({ decisionId: decision, kind: "task", discriminator: "gps", ordinal: 1 }));
});

test("different concurrent messages produce different identities before persistence", async () => {
  const values = await Promise.all(["a", "b"].map(async (messageId) => cleanDecisionId({ tenantId: "tenant", conversationId: "conversation", messageId })));
  assert.notEqual(values[0], values[1]);
});

test("three complete corpus repetitions use globally unique deterministic message ids", () => {
  const runId = "fixed-run"; const ids: string[] = [];
  for (let repetition = 0; repetition < 3; repetition++) {
    const sessionId = `session-${repetition}`;
    for (const [turnIndex, item] of CLEAN_LIVE_SYNTHETIC_CORPUS.entries()) ids.push(cleanLiveMessageId({ runId, sessionId, caseId: item.id, turnIndex }));
  }
  assert.equal(new Set(ids).size, CLEAN_LIVE_SYNTHETIC_CORPUS.length * 3);
  assert.deepEqual(ids, ids.map((_, index) => {
    const repetition = Math.floor(index / CLEAN_LIVE_SYNTHETIC_CORPUS.length); const turnIndex = index % CLEAN_LIVE_SYNTHETIC_CORPUS.length;
    return cleanLiveMessageId({ runId, sessionId: `session-${repetition}`, caseId: CLEAN_LIVE_SYNTHETIC_CORPUS[turnIndex]!.id, turnIndex });
  }));
  assert.equal(CLEAN_LIVE_SYNTHETIC_CORPUS.some((item) => item.context === "previous_unit"), true);
  assert.equal(CLEAN_LIVE_SYNTHETIC_CORPUS.some((item) => item.context === "without_previous_unit"), true);
});
