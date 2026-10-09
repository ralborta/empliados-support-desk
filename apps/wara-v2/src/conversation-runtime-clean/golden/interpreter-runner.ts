import { createEmptyCleanState } from "../core/types/state.js";
import { StableInterpreterAdapter, type StableInterpreterTransport } from "../adapters/interpreter/stable-interpreter-adapter.js";

export async function runGoldenInterpreterFixtures(input: { transport: StableInterpreterTransport; messages: readonly string[] }) {
  const adapter = new StableInterpreterAdapter(input.transport);
  const state = createEmptyCleanState({ tenantId: "golden-synthetic", conversationId: "golden-synthetic" });
  const results = [];
  for (const message of input.messages) results.push(await adapter.interpret({ message, state }));
  return results;
}
