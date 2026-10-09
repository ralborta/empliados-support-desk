/**
 * Diagnóstico incremental del Interpreter (shadow/local).
 * pnpm exec tsx src/conversation-runtime-next/tests/interpreter-diag.ts
 * pnpm exec tsx src/conversation-runtime-next/tests/interpreter-diag.ts --full-smoke
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createEmptyConversationStateV3 } from "../../commander-v3/types/state.js";
import { initCommanderV3PersistenceFromEnv } from "../../commander-v3/index.js";
import { resetConversationStateV3 } from "../../commander-v3/persistence/store.js";
import {
  getConversationStateV3,
  saveConversationStateV3,
} from "../../commander-v3/persistence/store-helpers.js";
import {
  callInterpreter,
  callInterpreterMinimal,
} from "../interpreter/call.js";
import {
  buildInterpreterUserPayload,
  INTERPRETER_SYSTEM_PROMPT,
} from "../interpreter/prompt.js";
import { listRegistryForPrompt } from "../registry/service-registry.js";
import { processConversationTurn } from "../process-turn.js";
import { migrateV3ToVNext } from "../state/migrate.js";

initCommanderV3PersistenceFromEnv(process.env);

const tenant = "tenant_interp_diag";
const phone = "+5491199008888";
const env = {
  ...process.env,
  ALLOW_EXTERNAL_MUTATIONS: "false",
  DELIVERY_ENABLED: "false",
  WARA_V2_PILOT_OPEN: "true",
};

type StepResult = {
  name: string;
  ok: boolean;
  latencyMs: number;
  failureKind?: string | null;
  userAct?: string;
  relation?: string;
  schemaErrors?: string[];
  error?: string;
};

const report: {
  at: string;
  steps: StepResult[];
  stability: StepResult[];
  multiTurn: Array<{ name: string; ok: boolean; turns: StepResult[] }>;
  fullSmoke?: { ok: boolean; output: string };
} = { at: new Date().toISOString(), steps: [], stability: [], multiTurn: [] };

function gpsOpenState() {
  const s = createEmptyConversationStateV3({ tenantId: tenant, phone });
  s.company = { id: "1", name: "Smoke Co", contactId: 1 };
  s.activeTask = {
    type: "gps",
    status: "collecting",
    collected: {},
    missing: ["unit"],
  };
  s.lastQuestion = { id: "q1", purpose: "unit_for_gps", expected: "unit" };
  return s;
}

async function runStep(name: string, fn: () => Promise<StepResult>): Promise<StepResult> {
  const r = await fn();
  report.steps.push({ ...r, name });
  const mark = r.ok ? "OK" : "FAIL";
  console.log(`[${mark}] ${name} ${r.latencyMs}ms ${r.failureKind ?? ""} ${r.userAct ?? ""}/${r.relation ?? ""}`);
  if (!r.ok && r.schemaErrors?.length) {
    console.log(`  schema: ${r.schemaErrors.slice(0, 3).join("; ")}`);
  }
  if (!r.ok && r.error) console.log(`  err: ${r.error.slice(0, 120)}`);
  return r;
}

async function incrementalSteps() {
  console.log("\n=== Conectividad mínima ===");
  await runStep("minimal_hola", async () => {
    const r = await callInterpreterMinimal({ message: "Hola", env });
    return {
      ok: Boolean(r.interpretation),
      latencyMs: r.attemptDiag.latencyMs,
      failureKind: r.attemptDiag.failureKind,
      userAct: r.interpretation?.userAct,
      relation: r.interpretation?.relation,
      schemaErrors: r.attemptDiag.schemaErrors,
      error: r.attemptDiag.safeErrorMessage,
    };
  });

  console.log("\n=== Incremental ===");
  const baseState = createEmptyConversationStateV3({ tenantId: tenant, phone });

  await runStep("1_message_only", async () => {
    const r = await callInterpreter({
      message: "Hola",
      state: baseState,
      env,
      lastAssistantReply: null,
    });
    return stepFromCall(r);
  });

  await runStep("2_message_schema_prompt", async () => {
    const r = await callInterpreter({
      message: "¿cuál es mi empresa?",
      state: baseState,
      env,
    });
    return stepFromCall(r);
  });

  const withCompany = { ...baseState, company: { id: "1", name: "Smoke Co", contactId: 1 } };
  await runStep("3_message_context", async () => {
    const r = await callInterpreter({
      message: "¿cuál es mi empresa?",
      state: withCompany,
      env,
    });
    return stepFromCall(r);
  });

  const gpsState = gpsOpenState();
  await runStep("4_gps_open_work", async () => {
    const r = await callInterpreter({
      message: "Hola",
      state: gpsState,
      env,
      lastAssistantReply: "¿De qué unidad? Pasame la patente.",
    });
    return stepFromCall(r);
  });

  await runStep("5_registry_in_system", async () => {
    const payload = buildInterpreterUserPayload({
      message: "gps de la unidad",
      state: gpsState,
    });
    const r = await callInterpreter({
      message: "gps de la unidad",
      state: gpsState,
      env,
    });
    console.log(`  payloadChars=${payload.length} systemChars=${INTERPRETER_SYSTEM_PROMPT.length} registryChars=${listRegistryForPrompt().length}`);
    return stepFromCall(r);
  });

  await runStep("6_full_payload", async () => {
    const r = await callInterpreter({
      message: "Dejá eso, mejor carguemos el kilometraje.",
      state: gpsState,
      env,
      lastAssistantReply: "¿De qué unidad?",
    });
    return stepFromCall(r);
  });
}

function stepFromCall(r: Awaited<ReturnType<typeof callInterpreter>>): StepResult {
  return {
    ok: Boolean(r.interpretation),
    latencyMs: r.latencyMs,
    failureKind: r.failureKind,
    userAct: r.interpretation?.userAct,
    relation: r.interpretation?.relation,
    schemaErrors: r.diagnostic.attempts.find((a) => a.schemaErrors)?.schemaErrors,
    error: r.error,
  };
}

async function stabilityRuns() {
  console.log("\n=== Estabilidad: 10 mínimas ===");
  for (let i = 0; i < 10; i++) {
    const r = await callInterpreterMinimal({ message: "Hola", env });
    const step: StepResult = {
      name: `minimal_${i + 1}`,
      ok: Boolean(r.interpretation),
      latencyMs: r.attemptDiag.latencyMs,
      failureKind: r.attemptDiag.failureKind,
      userAct: r.interpretation?.userAct,
      relation: r.interpretation?.relation,
    };
    report.stability.push(step);
    if (!step.ok) console.log(`FAIL minimal ${i + 1}: ${step.failureKind}`);
  }

  console.log("\n=== Estabilidad: 10 interpretaciones completas ===");
  const s = gpsOpenState();
  for (let i = 0; i < 10; i++) {
    const r = await callInterpreter({
      message: i % 2 === 0 ? "Hola" : "¿cuál es mi empresa?",
      state: s,
      env,
      lastAssistantReply: i % 2 === 0 ? "¿De qué unidad?" : null,
    });
    const step = { name: `full_${i + 1}`, ...stepFromCall(r) };
    report.stability.push(step);
    if (!step.ok) console.log(`FAIL full ${i + 1}: ${step.failureKind} ${step.error ?? ""}`);
  }
}

async function multiTurnSessions() {
  console.log("\n=== Multi-turno (5 sesiones) ===");
  const scenarios = [
    { name: "saludo_gps", messages: ["¿Dónde está la unidad?", "Hola"] },
    { name: "lateral_empresa", messages: ["gps de la unidad", "¿cuál es mi empresa?"] },
    { name: "switch_odometro", messages: ["ubicación", "Dejá eso, mejor carguemos el kilometraje."] },
    { name: "confirmo_sin", messages: ["CONFIRMO"] },
    { name: "mantenimiento", messages: ["registrar mantenimiento de la 431"] },
  ];

  for (const sc of scenarios) {
    resetConversationStateV3(tenant, phone + sc.name.length);
    const p = phone + sc.name.length;
    if (sc.name === "saludo_gps" || sc.name === "lateral_empresa" || sc.name === "switch_odometro") {
      const st = gpsOpenState();
      st.tenantId = tenant;
      st.phone = p;
      saveConversationStateV3(st);
    }
    const turns: StepResult[] = [];
    let ok = true;
    for (let i = 0; i < sc.messages.length; i++) {
      const msg = sc.messages[i]!;
      const stateBefore = getConversationStateV3(tenant, p);
      const vnextBefore = stateBefore ? migrateV3ToVNext(stateBefore) : null;
      if (sc.name === "saludo_gps" && i === 1) {
        console.log(
          `  ctx openWork=${JSON.stringify(stateBefore?.activeTask)} focused=${vnextBefore?.focusedTaskId} expected=${stateBefore?.lastQuestion?.expected}`,
        );
      }
      const r = await processConversationTurn({
        tenantId: tenant,
        phone: p,
        message: msg,
        messageId: `${sc.name}_${i}`,
        env,
        contacts: [{ id: 1, nombre: "Smoke Co", empresa: "Smoke Co" }],
      });
      const diag = r.trace.runtimeNext?.interpreterDiagnostic;
      const interpOk = Boolean(r.trace.runtimeNext?.interpretation);
      const step: StepResult = {
        name: msg,
        ok: interpOk && !r.trace.writeExecuted,
        latencyMs: diag?.latencyMs ?? r.trace.latency?.commanderMs ?? 0,
        failureKind: diag?.finalFailureKind,
        userAct: r.trace.runtimeNext?.interpretation?.userAct,
        relation: r.trace.runtimeNext?.interpretation?.relation,
        error: diag?.fallbackReason ?? undefined,
      };
      turns.push(step);
      if (!step.ok) ok = false;
      console.log(`  ${sc.name} [${msg.slice(0, 40)}] ok=${step.ok} act=${step.userAct}/${step.relation} fail=${step.failureKind ?? "-"}`);
    }
    report.multiTurn.push({ name: sc.name, ok, turns });
  }
}

async function fullSmoke() {
  console.log("\n=== Smoke completo (secuencial) ===");
  const { spawnSync } = await import("node:child_process");
  const r = spawnSync(
    "pnpm",
    ["exec", "tsx", "src/conversation-runtime-next/tests/live-smoke.ts"],
    {
      cwd: join(process.cwd()),
      env: env as Record<string, string>,
      encoding: "utf8",
      timeout: 900_000,
    },
  );
  const output = (r.stdout ?? "") + (r.stderr ?? "");
  report.fullSmoke = { ok: r.status === 0, output: output.slice(-8000) };
  console.log(output.slice(-2000));
}

async function main() {
  if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY.length < 20) {
    console.log("BLOCKED: OPENAI_API_KEY requerida");
    process.exit(1);
  }

  await incrementalSteps();
  await stabilityRuns();
  await multiTurnSessions();

  if (process.argv.includes("--full-smoke")) {
    await fullSmoke();
  }

  const out = join(process.cwd(), "src/conversation-runtime-next/tests/interpreter-diag-report.json");
  writeFileSync(out, JSON.stringify(report, null, 2), "utf8");
  console.log(`\nReporte: ${out}`);

  const failed =
    report.steps.some((s) => !s.ok) ||
    report.stability.some((s) => !s.ok) ||
    report.multiTurn.some((s) => !s.ok) ||
    (report.fullSmoke && !report.fullSmoke.ok);

  if (failed) process.exit(1);
  console.log("\nDiagnóstico: todas las verificaciones pasaron.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
