import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";
import { createEmptyCleanState } from "../core/types/state.js";
import { loadCleanRuntimeConfig } from "../config/clean-config.js";
import { RuntimeNextStableTransport } from "../adapters/interpreter/runtime-next-stable-transport.js";
import { StableInterpreterAdapter } from "../adapters/interpreter/stable-interpreter-adapter.js";
import { CLEAN_LIVE_SYNTHETIC_CORPUS } from "./synthetic-corpus.js";
import { cleanLiveMessageId } from "./corpus-identity.js";
import { stableCleanId } from "../core/identity/stable-id.js";

function stateFor(context: "previous_unit" | "without_previous_unit" | undefined) {
  const state = createEmptyCleanState({ tenantId: "clean-live-synthetic", conversationId: "clean-live-synthetic" });
  if (context !== "previous_unit") return state;
  const company = { id: "synthetic-company", name: "Synthetic" };
  return { ...state, company, unit: { id: "synthetic-current", label: "Current", companyId: company.id }, previousUnit: { id: "synthetic-previous", label: "Previous", companyId: company.id } };
}

export async function runCleanLiveCorpus(env: NodeJS.ProcessEnv = process.env, options: Readonly<{ runId?: string; repetitions?: number }> = {}) {
  const config = loadCleanRuntimeConfig(env);
  if (!config.runtimeEnabled || !config.llmEnabled) return { skipped: true as const, reason: "clean_llm_disabled", cases: [] };
  if (!env.OPENAI_API_KEY) return { skipped: true as const, reason: "credential_unavailable", cases: [] };
  const adapter = new StableInterpreterAdapter(new RuntimeNextStableTransport(env));
  const runId = options.runId ?? randomUUID(); const repetitions = options.repetitions ?? 3; const cases = [];
  for (let repetition = 0; repetition < repetitions; repetition++) for (const [turnIndex, item] of CLEAN_LIVE_SYNTHETIC_CORPUS.entries()) {
    const sessionId = stableCleanSessionId(runId, repetition); const messageId = cleanLiveMessageId({ runId, sessionId, caseId: item.id, turnIndex });
    const start = performance.now(); const interpretation = await adapter.interpret({ message: item.message, state: stateFor(item.context) });
    cases.push({ id: item.id, category: item.category, context: item.context ?? "empty", repetition, sessionId, messageId, interpreted: Boolean(interpretation), userAct: interpretation?.userAct ?? null, relation: interpretation?.relation ?? null, intentCount: interpretation?.intents.length ?? 0, latencyMs: Math.round(performance.now() - start), diagnostic: adapter.lastDiagnostic?.code ?? null });
  }
  return { skipped: false as const, runId, cases };
}

function stableCleanSessionId(runId: string, repetition: number): string { return stableCleanId("message", ["session", runId, repetition]); }
