/**
 * Diagnóstico live LLM — GPS reporte + cierre caso vs alarma (textos como tests, no reglas).
 *
 *   set -a && source ../../.env.local && set +a
 *   WARA_V2_UNIFIED_SEMANTIC_BRAIN=true WARA_V2_SEMANTIC_TRACE=true \
 *     pnpm exec tsx src/pilot/semantic/_diag-gps-close-acceptance.ts
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  resolveOperationalTurn,
  setPilotOperationalDepsForTests,
  resetPilotConversationStatesForTests,
} from "../operational-turn.js";
import {
  configurePilotStatePersistence,
  createEmptyPilotState,
  resetPilotConversationStatesForTests as resetStateStore,
  savePilotConversationState,
} from "../conversation-state.js";
import { setOdometerWriteDepsForTests } from "../odometer-turn.js";
import { setCertificateWriteDepsForTests } from "../certificate-turn.js";
import {
  clearSemanticTraces,
  getSemanticTraces,
  type SemanticTraceRecord,
} from "../semantic-trace.js";
import type { WaraUnidadEstado } from "../wara-types.js";

const PHONE = "+5491100000888";
const TENANT = "tenant_gps_close_diag";
const CONTACTS = [
  { id: 1, nombre: "Diag", empresa: "El Cacique" },
  { id: 2, nombre: "Diag2", empresa: "Roca" },
];

const UNITS: WaraUnidadEstado[] = [
  {
    movil_id: 137,
    unidad: "M900-137",
    patente: "AD307VS",
    odometro: 120000,
    horometro: 4500,
    ultimo_reporte: { hace_segundos: 90 },
  },
  {
    movil_id: 100,
    unidad: "M600-001",
    patente: "AA815BB",
    odometro: 150000,
    horometro: 3200,
    ultimo_reporte: { hace_segundos: 200 },
  },
];

let msgSeq = 0;
function mid(s: string) {
  msgSeq += 1;
  return `gps-close-${s}-${msgSeq}`;
}

function publicTrace(t: SemanticTraceRecord) {
  return {
    message: t.message,
    activeTramite: t.activeTramite,
    activeStep: t.activeStep,
    lastQuestion: t.lastQuestion,
    selectedUnit: t.selectedUnit,
    semanticInterpreterCalled: t.semanticInterpreterCalled,
    model: t.model,
    turnDecision: t.turnDecision,
    handlerSelected: t.handlerSelected,
    selectionReason: t.selectionReason,
    replyKind: t.replyKind,
    replyPreview: t.replyPreview,
    stateTransition: t.stateTransition,
  };
}

async function turn(text: string) {
  return resolveOperationalTurn({
    tenantId: TENANT,
    phone: PHONE,
    text,
    messageId: mid("m"),
    env: {
      ...process.env,
      WARA_V2_UNIFIED_SEMANTIC_BRAIN: "true",
      WARA_V2_SEMANTIC_TRACE: "true",
      WARA_OBTENER_EMPRESA_TOKEN: "x",
      WARA_API_BASE_URL: "http://mock",
      ALLOW_EXTERNAL_MUTATIONS: "false",
      WARA_V2_ODOMETER_WRITE_ENABLED: "false",
      WARA_V2_CERTIFICATE_WRITE_ENABLED: "false",
    },
    contacts: CONTACTS,
  });
}

function seedIdle() {
  const st = createEmptyPilotState({ tenantId: TENANT, phone: PHONE, contacts: CONTACTS });
  st.sessionToken = "tok";
  st.selectedContactId = 1;
  st.companyName = "El Cacique";
  st.fleetCache = UNITS;
  st.fleetCacheAt = new Date().toISOString();
  st.activeTramite = "none";
  st.step = "idle";
  return st;
}

async function main() {
  if (!process.env.OPENAI_API_KEY?.trim()) {
    console.error("Falta OPENAI_API_KEY");
    process.exit(1);
  }

  resetStateStore();
  resetPilotConversationStatesForTests();
  clearSemanticTraces();
  const tempDir = mkdtempSync(join(tmpdir(), "wara-v2-gps-close-"));
  configurePilotStatePersistence(join(tempDir, "state.json"));
  setPilotOperationalDepsForTests({
    createToken: async () => ({ ok: true, sessionToken: "tok" }),
    consultarFleet: async () => ({ ok: true, unidades: UNITS }),
  });
  setOdometerWriteDepsForTests({
    registerReading: async () => ({ ok: true, summary: "dry", payload: {} }),
  });
  setCertificateWriteDepsForTests({
    issue: async () => ({ ok: true, summary: "dry", payload: {} }),
  });

  const scenarios: Array<{
    id: string;
    expected: string;
    setup: () => void;
    texts: string[];
  }> = [
    {
      id: "A_gps_reporte",
      expected: "start_gps / ask unit — no silencio, no paneles genéricos",
      setup: () => {
        const st = seedIdle();
        savePilotConversationState(st);
      },
      texts: ["GPS reporte"],
    },
    {
      id: "B_cierra_caso",
      expected: "close_case / confirm write — no paneles Alarmas",
      setup: () => {
        const st = seedIdle();
        st.selectedUnit = {
          movil_id: 137,
          patente: "AD307VS",
          unidad: "M900-137",
          label: "AD 307 VS (M900-137)",
        };
        savePilotConversationState(st);
      },
      texts: ["Si x favor cierra"],
    },
    {
      id: "C_como_cierro_alarma",
      expected: "domain_knowledge alarmas — NO close_case",
      setup: () => {
        const st = seedIdle();
        savePilotConversationState(st);
      },
      texts: ["Cómo cierro una alarma"],
    },
  ];

  const report: unknown[] = [];

  for (const sc of scenarios) {
    clearSemanticTraces();
    resetStateStore();
    resetPilotConversationStatesForTests();
    configurePilotStatePersistence(join(tempDir, `state-${sc.id}.json`));
    sc.setup();

    const turns: unknown[] = [];
    for (const text of sc.texts) {
      const r = await turn(text);
      const traces = getSemanticTraces();
      const last = traces[traces.length - 1];
      turns.push({
        text,
        resultKind: r.kind,
        message:
          r.kind === "reply" || r.kind === "duplicate"
            ? r.message
            : r.kind === "llm"
              ? "[llm_fallback]"
              : null,
        messageLen:
          r.kind === "reply" || r.kind === "duplicate" ? r.message.length : 0,
        emptyReply:
          (r.kind === "reply" || r.kind === "duplicate") && !r.message.trim(),
        state: {
          activeTramite: r.state.activeTramite,
          step: r.state.step,
          expectedField: r.state.expectedField,
          pendingAction: r.state.pendingAction?.action ?? null,
          lastAgentQuestion: r.state.lastAgentQuestion ?? null,
        },
        trace: last ? publicTrace(last) : null,
      });
    }
    report.push({ id: sc.id, expected: sc.expected, turns });
    console.log(JSON.stringify({ id: sc.id, turns }, null, 2));
  }

  const outPath = join(tempDir, "diag-report.json");
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: true, outPath, scenarios: report.length }));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
