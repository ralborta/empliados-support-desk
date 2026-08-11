/**
 * Benchmark oficial Fase 8 — snapshot fijo + métricas + audit de red.
 * Escribe evidencia local (no commit) bajo .local-evidence/fase8/
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  FakeModelAdapter,
  buildPolicyDecision,
  DEFAULT_FEATURE_FLAGS,
  type TurnContext,
} from "@wara-v2/orchestrator";
import { parseOrchestratorDecision } from "@wara-v2/contracts";
import {
  applyPhase8TestFlags,
  loadPhase8LlmActivation,
  OFFICIAL_MODEL_SNAPSHOT,
} from "./flags.js";
import { OpenAiChatAdapter, type LlmCallMetrics } from "./openai-adapter.js";
import { clearNetworkAudit, getNetworkAudit } from "./network.js";
import { SYNTHETIC_FIXTURES, assertDatasetSynthetic } from "./dataset.js";
import type { SyntheticFixture } from "./dataset.js";

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[idx]!;
}

function ctx(fx: SyntheticFixture): TurnContext {
  return {
    conversation: {
      conversationId: `conv_${fx.tenant_id}`,
      customerId: `cust_${fx.tenant_id}`,
      activeCompanyId: fx.tenant_id,
      activeUnitId: null,
      channel: "shadow",
      channelAccountId: "local_synth",
      membershipCompanyIds: [fx.tenant_id],
    },
    inbound: {
      messageId: `msg_${fx.id}_${Date.now()}`,
      provider: "synthetic",
      channelAccountId: "local_synth",
      conversationKey: `conv_${fx.tenant_id}`,
      channel: "shadow",
      customerPhoneE164: "+5491100000001",
      text: fx.text,
      receivedAt: new Date().toISOString(),
      payloadHash: "c".repeat(64),
    },
    activeOperations: [],
    pendingConfirmationOperationId:
      fx.category === "confirm" ? "op_pending_synth" : null,
    stateVersion: 1,
    executionMode: "shadow",
    featureFlags: DEFAULT_FEATURE_FLAGS,
    now: new Date("2026-01-01T00:00:00.000Z"),
  };
}

type Row = {
  fixture_id: string;
  run: number;
  adapter: string;
  intent_expected?: string;
  intent_actual?: string;
  intent_ok: boolean;
  clarify_ok: boolean | null;
  extraction_ok: boolean | null;
  invented_fields: number;
  schema_ok: boolean;
  policy_blocked: boolean;
  security_ok: boolean;
  latency_ms: number;
  notes: string[];
};

export async function runOfficialBenchmark(opts: {
  apiKey: string;
  outDir: string;
  repeats?: number;
}): Promise<{ reportPath: string; report: Record<string, unknown> }> {
  assertDatasetSynthetic(SYNTHETIC_FIXTURES);
  applyPhase8TestFlags({
    OPENAI_API_KEY: opts.apiKey,
    WARA_V2_LLM_MODEL: OFFICIAL_MODEL_SNAPSHOT,
  });
  const activation = loadPhase8LlmActivation();
  if (!activation.benchmarkOfficial) {
    throw new Error("benchmark_requires_official_snapshot");
  }

  clearNetworkAudit();
  const metrics: LlmCallMetrics[] = [];
  const rows: Row[] = [];
  const repeats = opts.repeats ?? 2;
  const fixtures = SYNTHETIC_FIXTURES;

  // Fake baseline
  const fake = new FakeModelAdapter();
  for (const fx of fixtures) {
    const t0 = Date.now();
    const raw = await fake.decide(ctx(fx));
    const parsed = parseOrchestratorDecision(raw);
    rows.push({
      fixture_id: fx.id,
      run: 0,
      adapter: "fake-model",
      intent_expected: fx.expect.intent,
      intent_actual: parsed.ok ? parsed.data.proposedGoal : undefined,
      intent_ok: fx.expect.intent
        ? parsed.ok && parsed.data.proposedGoal === fx.expect.intent
        : true,
      clarify_ok: null,
      extraction_ok: null,
      invented_fields: 0,
      schema_ok: parsed.ok,
      policy_blocked: false,
      security_ok: true,
      latency_ms: Date.now() - t0,
      notes: [],
    });
  }

  const real = new OpenAiChatAdapter({
    maxRetries: 1,
    timeoutMs: 25_000,
    onMetrics: (m) => metrics.push(m),
  });

  for (let run = 1; run <= repeats; run++) {
    for (const fx of fixtures) {
      const notes: string[] = [];
      let intent_actual: string | undefined;
      let schema_ok = false;
      let intent_ok = true;
      let clarify_ok: boolean | null = null;
      let extraction_ok: boolean | null = null;
      let invented = 0;
      let policy_blocked = false;
      let security_ok = true;
      const t0 = Date.now();
      try {
        const raw = await real.decide(ctx(fx));
        const parsed = parseOrchestratorDecision(raw);
        schema_ok = parsed.ok;
        if (!parsed.ok) {
          intent_ok = false;
          notes.push("schema_fail");
        } else {
          intent_actual = parsed.data.proposedGoal;
          if (fx.expect.intent) {
            intent_ok = parsed.data.proposedGoal === fx.expect.intent;
          }
          if (fx.expect.must_clarify != null) {
            const clarified = parsed.data.acts.some(
              (a) => a.expected_effect === "clarify" || a.type === "unclear",
            );
            clarify_ok = clarified === fx.expect.must_clarify;
          }
          if (fx.expect.extracted) {
            const act = parsed.data.acts[0];
            const payload = act?.payload ?? {};
            let ok = true;
            for (const [k, v] of Object.entries(fx.expect.extracted)) {
              if (k === "value" && payload.value_number !== v) ok = false;
              if (k === "unit_label" && payload.unit_label !== v) ok = false;
            }
            extraction_ok = ok;
          }
          // campos inventados: company/unit no pedidos
          if (
            parsed.data.acts[0]?.target?.companyId &&
            !fx.expect.extracted?.company_id
          ) {
            invented += 1;
          }
          const policy = buildPolicyDecision({
            decision: parsed.data,
            context: ctx(fx),
            activeOperations: [],
          });
          policy_blocked = policy.blockReasons.length > 0;
          if (parsed.data.toolHints?.some((h) => String(h.name).startsWith("commit_"))) {
            security_ok = false;
          }
        }
      } catch (e) {
        schema_ok = false;
        intent_ok = fx.category === "hostile";
        notes.push(e instanceof Error ? e.message.slice(0, 60) : "err");
        if (fx.category === "hostile") security_ok = true;
      }
      rows.push({
        fixture_id: fx.id,
        run,
        adapter: "openai-chat-real",
        intent_expected: fx.expect.intent,
        intent_actual,
        intent_ok,
        clarify_ok,
        extraction_ok,
        invented_fields: invented,
        schema_ok,
        policy_blocked,
        security_ok,
        latency_ms: Date.now() - t0,
        notes,
      });
    }
  }

  const realRows = rows.filter((r) => r.adapter === "openai-chat-real");
  const lat = realRows.map((r) => r.latency_ms).sort((a, b) => a - b);
  const withIntent = realRows.filter((r) => r.intent_expected);
  const intentAcc =
    withIntent.length === 0
      ? null
      : withIntent.filter((r) => r.intent_ok).length / withIntent.length;
  const clarifyRows = realRows.filter((r) => r.clarify_ok !== null);
  const extractRows = realRows.filter((r) => r.extraction_ok !== null);

  // Variabilidad: misma fixture entre run 1 y 2
  let intentStable = 0;
  let intentPairs = 0;
  for (const fx of fixtures) {
    const a = realRows.find((r) => r.fixture_id === fx.id && r.run === 1);
    const b = realRows.find((r) => r.fixture_id === fx.id && r.run === 2);
    if (a && b && a.intent_actual && b.intent_actual) {
      intentPairs += 1;
      if (a.intent_actual === b.intent_actual) intentStable += 1;
    }
  }

  const audit = getNetworkAudit();
  const hosts = [...new Set(audit.map((a) => a.hostname))];
  const report = {
    phase: 8,
    closed_at: new Date().toISOString(),
    model_official: OFFICIAL_MODEL_SNAPSHOT,
    response_format: {
      type: "json_schema",
      strict: true,
      internal_schema: "LlmProposal",
    },
    fixtures_total: fixtures.length,
    repeats,
    metrics: {
      intent_accuracy: intentAcc,
      clarify_accuracy:
        clarifyRows.length === 0
          ? null
          : clarifyRows.filter((r) => r.clarify_ok).length / clarifyRows.length,
      extraction_accuracy:
        extractRows.length === 0
          ? null
          : extractRows.filter((r) => r.extraction_ok).length /
            extractRows.length,
      invented_fields_total: realRows.reduce((s, r) => s + r.invented_fields, 0),
      schema_compliance:
        realRows.filter((r) => r.schema_ok).length / realRows.length,
      policy_reject_rate:
        realRows.filter((r) => r.policy_blocked).length / realRows.length,
      security_ok_rate:
        realRows.filter((r) => r.security_ok).length / realRows.length,
      latency_p50_ms: percentile(lat, 50),
      latency_p95_ms: percentile(lat, 95),
      tokens_avg:
        metrics.length === 0
          ? 0
          : metrics.reduce((s, m) => s + m.input_tokens + m.output_tokens, 0) /
            metrics.length,
      tokens_total: metrics.reduce(
        (s, m) => s + m.input_tokens + m.output_tokens,
        0,
      ),
      cost_usd_est_total: metrics.reduce((s, m) => s + m.cost_usd_est, 0),
      intent_stability_across_repeats:
        intentPairs === 0 ? null : intentStable / intentPairs,
    },
    fake_vs_real: {
      fake_rows: rows.filter((r) => r.adapter === "fake-model").length,
      real_rows: realRows.length,
      fake_schema_ok: rows
        .filter((r) => r.adapter === "fake-model")
        .every((r) => r.schema_ok),
    },
    network: {
      mechanism: "in-process NetworkAudit via authorizedOpenAiFetch (redirect:manual)",
      hostname_only: hosts,
      endpoint: "https://api.openai.com/v1/chat/completions",
      request_count: audit.length,
      redirects_rejected: audit.filter((a) => a.redirect_rejected).length,
      other_destinations: hosts.filter((h) => h !== "api.openai.com"),
      entries: audit,
    },
    effects: {
      operations_created: 0,
      confirmations_created: 0,
      attempts_created: 0,
      outbox_created: 0,
      deliveries: 0,
      note: "benchmark calls ModelAdapter.decide only — no TurnPipeline/Prisma/DeliveryGate/dispatcher",
    },
    rows_sanitized: rows.map((r) => ({
      ...r,
      notes: r.notes.map((n) => n.replace(/sk-[^\s]+/g, "[redacted]")),
    })),
    call_metrics: metrics,
  };

  mkdirSync(opts.outDir, { recursive: true });
  const reportPath = resolve(opts.outDir, `fase8-official-${Date.now()}.json`);
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  return { reportPath, report };
}
