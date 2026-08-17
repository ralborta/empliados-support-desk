import assert from "node:assert/strict";
import test from "node:test";
import { CLEAN_CAPABILITY_CATALOG } from "../core/authorization/capability-catalog.js";
import { CLEAN_POLICY_CATALOG } from "../core/policy/catalog.js";
import { GOLDEN_CORPUS, MULTITURN_GOLDEN_SCENARIOS } from "../golden/corpus.js";
import { runGoldenCorpus } from "../golden/deterministic-runner.js";
import { runGoldenInterpreterFixtures } from "../golden/interpreter-runner.js";
import type { StableInterpreterTransport } from "../adapters/interpreter/stable-interpreter-adapter.js";

test("golden corpus deterministically passes every scenario with zero writes", () => {
  const results = runGoldenCorpus(GOLDEN_CORPUS);
  assert.ok(results.length > 39);
  assert.deepEqual(results.filter((result) => !result.passed), []);
  for (const scenario of GOLDEN_CORPUS) for (const turn of scenario.turns) {
    assert.equal(turn.expectation.writeAttempt, false); assert.equal(turn.expectation.writeExecuted, false);
  }
});
test("golden corpus covers every capability and Clean policy", () => {
  const capabilities = new Set(GOLDEN_CORPUS.flatMap((scenario) => scenario.capabilities));
  const policies = new Set(GOLDEN_CORPUS.flatMap((scenario) => scenario.policies));
  assert.deepEqual(CLEAN_CAPABILITY_CATALOG.map((item) => item.name).filter((name) => !capabilities.has(name)), []);
  assert.deepEqual(CLEAN_POLICY_CATALOG.map((item) => item.id).filter((id) => !policies.has(id)), []);
});
test("critical domains have complete multi-turn scenarios", () => {
  const categories = new Set(MULTITURN_GOLDEN_SCENARIOS.map((scenario) => scenario.category));
  for (const category of ["company", "unit", "gps", "odometer", "hourmeter", "maintenance", "certificate", "handoff", "ticket", "attachment", "knowledge", "conversation", "recovery", "safety"]) assert.ok(categories.has(category));
  assert.ok(MULTITURN_GOLDEN_SCENARIOS.some((scenario) => scenario.id === "flow:ticket-lifecycle" && scenario.turns.length >= 9));
});
test("interpreter LLM runner is injectable and performs no implicit live call", async () => {
  class Transport implements StableInterpreterTransport {
    calls = 0;
    async call() { this.calls += 1; return { userAct: "question", relation: "standalone", normalizedMeaning: "fixture", requests: [], references: [], corrections: [], answersExpectedField: false, confidence: 1 }; }
  }
  const transport = new Transport();
  const results = await runGoldenInterpreterFixtures({ transport, messages: ["fixture one", "fixture two"] });
  assert.equal(transport.calls, 2); assert.equal(results.length, 2); assert.ok(results.every(Boolean));
});
