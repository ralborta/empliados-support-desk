import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";
import { createEmptyCleanState } from "../core/types/state.js";
import { loadCleanRuntimeConfig } from "../config/clean-config.js";
import { CleanOpenAiInterpreterTransport } from "../adapters/interpreter/clean-openai-interpreter-transport.js";
import { StableInterpreterAdapter } from "../adapters/interpreter/stable-interpreter-adapter.js";
import { CLEAN_LIVE_SYNTHETIC_CORPUS } from "./synthetic-corpus.js";
import { cleanLiveMessageId } from "./corpus-identity.js";
import { stableCleanId } from "../core/identity/stable-id.js";

function stateFor(context: "previous_unit" | "without_previous_unit" | "expected_date" | "expected_unit" | "expected_company" | "pending_hourmeter" | undefined) {
  const state = createEmptyCleanState({ tenantId: "clean-live-synthetic", conversationId: "clean-live-synthetic" });
  const company = { id: "synthetic-company", name: "Synthetic" };
  if (context === "previous_unit") return { ...state, company, unit: { id: "synthetic-current", label: "Current", companyId: company.id }, previousUnit: { id: "synthetic-previous", label: "Previous", companyId: company.id } };
  if (context === "expected_unit") {
    const task = { id: "synthetic-task-unit", type: "hourmeter" as const, status: "collecting" as const, collectedFields: {}, createdAt: "synthetic", updatedAt: "synthetic" };
    return { ...state, company, tasks: [task], focusedTaskId: task.id, expectedInput: { field: "unit" as const, taskId: task.id, purpose: "hourmeter_unit" } };
  }
  if (context === "expected_company") {
    const unitReference = { type: "unit" as const, expression: "900113", source: "message" as const, unitReferenceKind: "internal_code" as const };
    const task = { id: "synthetic-task-company", type: "gps" as const, status: "collecting" as const, collectedFields: { unitReference }, createdAt: "synthetic", updatedAt: "synthetic" };
    return { ...state, tasks: [task], focusedTaskId: task.id, expectedInput: { field: "company" as const, taskId: task.id, purpose: "gps_company" } };
  }
  if (context === "expected_date") {
    const task = { id: "synthetic-task-date", type: "hourmeter" as const, status: "collecting" as const, collectedFields: { value: 98 }, createdAt: "synthetic", updatedAt: "synthetic" };
    return { ...state, company, unit: { id: "synthetic-unit", label: "M900-115", companyId: company.id }, tasks: [task], focusedTaskId: task.id,
      expectedInput: { field: "date" as const, taskId: task.id, purpose: "hourmeter_date" } };
  }
  if (context === "pending_hourmeter") {
    const task = { id: "synthetic-task-pending", type: "hourmeter" as const, status: "awaiting_confirmation" as const,
      collectedFields: { value: 98, date: "2026-08-17", time: "18:00" }, createdAt: "synthetic", updatedAt: "synthetic" };
    return { ...state, company, unit: { id: "synthetic-unit", label: "M900-110", companyId: company.id }, tasks: [task], focusedTaskId: task.id,
      pendingOperation: { operationId: "synthetic-operation", capability: "hourmeter.update", taskId: task.id, version: 1, payloadHash: "synthetic-hash", idempotencyKey: "synthetic-idempotency",
        preparedArguments: task.collectedFields, status: "awaiting_confirmation" as const } };
  }
  return state;
}

export async function runCleanLiveCorpus(env: NodeJS.ProcessEnv = process.env, options: Readonly<{ runId?: string; repetitions?: number }> = {}) {
  const config = loadCleanRuntimeConfig(env);
  if (!config.runtimeEnabled || !config.llmEnabled) return { skipped: true as const, reason: "clean_llm_disabled", cases: [] };
  if (!env.OPENAI_API_KEY) return { skipped: true as const, reason: "credential_unavailable", cases: [] };
  const adapter = new StableInterpreterAdapter(new CleanOpenAiInterpreterTransport(env));
  const runId = options.runId ?? randomUUID(); const repetitions = options.repetitions ?? 3; const cases = [];
  for (let repetition = 0; repetition < repetitions; repetition++) for (const [turnIndex, item] of CLEAN_LIVE_SYNTHETIC_CORPUS.entries()) {
    const sessionId = stableCleanSessionId(runId, repetition); const messageId = cleanLiveMessageId({ runId, sessionId, caseId: item.id, turnIndex });
    const start = performance.now(); const interpretation = await adapter.interpret({ message: item.message, state: stateFor(item.context) });
    cases.push({ id: item.id, category: item.category, context: item.context ?? "empty", repetition, sessionId, messageId, interpreted: Boolean(interpretation),
      userAct: interpretation?.userAct ?? null, relation: interpretation?.relation ?? null, services: interpretation?.intents.map((intent) => intent.serviceId) ?? [],
      references: interpretation?.references.map((reference) => ({ type: reference.type, source: reference.source, unitReferenceKind: reference.unitReferenceKind ?? null })) ?? [],
      suppliedFields: interpretation?.suppliedFields.map((field) => ({ field: field.field, value: field.value })) ?? [], ambiguity: interpretation?.ambiguity?.reason ?? null,
      latencyMs: Math.round(performance.now() - start), diagnostic: adapter.lastDiagnostic?.code ?? null });
  }
  return { skipped: false as const, runId, cases };
}

function stableCleanSessionId(runId: string, repetition: number): string { return stableCleanId("message", ["session", runId, repetition]); }
