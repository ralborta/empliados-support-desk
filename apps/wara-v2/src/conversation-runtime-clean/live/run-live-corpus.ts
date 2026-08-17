import { performance } from "node:perf_hooks";
import { createEmptyCleanState } from "../core/types/state.js";
import { loadCleanRuntimeConfig } from "../config/clean-config.js";
import { RuntimeNextStableTransport } from "../adapters/interpreter/runtime-next-stable-transport.js";
import { StableInterpreterAdapter } from "../adapters/interpreter/stable-interpreter-adapter.js";
import { CLEAN_LIVE_SYNTHETIC_CORPUS } from "./synthetic-corpus.js";

export async function runCleanLiveCorpus(env: NodeJS.ProcessEnv = process.env) {
  const config = loadCleanRuntimeConfig(env);
  if (!config.runtimeEnabled || !config.llmEnabled) return { skipped: true as const, reason: "clean_llm_disabled", cases: [] };
  if (!env.OPENAI_API_KEY) return { skipped: true as const, reason: "credential_unavailable", cases: [] };
  const adapter = new StableInterpreterAdapter(new RuntimeNextStableTransport(env));
  const state = createEmptyCleanState({ tenantId: "clean-live-synthetic", conversationId: "clean-live-synthetic" });
  const cases = [];
  for (const item of CLEAN_LIVE_SYNTHETIC_CORPUS) {
    const start = performance.now(); const interpretation = await adapter.interpret({ message: item.message, state });
    cases.push({ id: item.id, category: item.category, interpreted: Boolean(interpretation), userAct: interpretation?.userAct ?? null, relation: interpretation?.relation ?? null, intentCount: interpretation?.intents.length ?? 0, latencyMs: Math.round(performance.now() - start), diagnostic: adapter.lastDiagnostic?.code ?? null });
  }
  return { skipped: false as const, cases };
}
