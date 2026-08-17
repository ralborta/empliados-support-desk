import assert from "node:assert/strict";
import { it } from "node:test";
import { loadCleanRuntimeConfig } from "../config/clean-config.js";
import { FactsOnlyLlmComposer } from "../adapters/composer/facts-only-composer.js";
import { createEmptyCleanState } from "../core/types/state.js";

const enabled = loadCleanRuntimeConfig({ WARA_CLEAN_RUNTIME_ENABLED: "true", WARA_CLEAN_LLM_ENABLED: "true" });
const input = { responsePlan: { purpose: "inform" as const, facts: [{ code: "ticket.id", source: "capability" as const, text: "El ticket es OD-4821.", verified: true }], nextQuestion: null, pendingTaskReminder: null, protectedBlocks: ["REF:OD-4821"] }, state: createEmptyCleanState({ tenantId: "t", conversationId: "c" }), customerName: "Raúl <admin>" };

it("lets the model choose style and order but renders verified facts and protected blocks literally", async () => {
  let seen: unknown;
  const composer = new FactsOnlyLlmComposer(enabled, { compose: async (request) => { seen = request; return { opening: "Perfecto.", factOrder: ["ticket.id"], closing: "¿Seguimos?" }; } });
  assert.equal(await composer.compose(input), "Perfecto.\nEl ticket es OD-4821.\nREF:OD-4821\n¿Seguimos?");
  assert.equal(JSON.stringify(seen).includes("<admin>"), false);
  assert.equal(JSON.stringify(seen).includes("capability"), false);
});

it("falls back on unknown, duplicated, omitted facts, unsafe style, empty output or transport failure", async () => {
  const variants = [
    { factOrder: ["invented"] }, { factOrder: [] }, { factOrder: ["ticket.id", "ticket.id"] },
    { opening: "<unsafe>", factOrder: ["ticket.id"] },
  ];
  for (const variant of variants) {
    const composer = new FactsOnlyLlmComposer(enabled, { compose: async () => variant });
    assert.equal(await composer.compose(input), "El ticket es OD-4821.");
  }
  const failed = new FactsOnlyLlmComposer(enabled, { compose: async () => { throw new Error("secret"); } });
  assert.equal(await failed.compose(input), "El ticket es OD-4821.");
});

it("does not call the model while the LLM gate is closed", async () => {
  let called = false;
  const composer = new FactsOnlyLlmComposer(loadCleanRuntimeConfig({}), { compose: async () => { called = true; return { factOrder: [] }; } });
  assert.equal(await composer.compose(input), "El ticket es OD-4821."); assert.equal(called, false);
});

