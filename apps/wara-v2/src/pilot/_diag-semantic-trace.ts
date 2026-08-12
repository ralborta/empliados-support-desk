/**
 * Trace obligatorio Etapa 1 — casos A–E.
 * WARA_V2_SEMANTIC_TRACE=true — sin secretos.
 *
 * Uso:
 *   WARA_V2_SEMANTIC_TRACE=true pnpm exec tsx src/pilot/_diag-semantic-trace.ts
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  resolveOperationalTurn,
  setPilotOperationalDepsForTests,
  resetPilotConversationStatesForTests,
  getPilotConversationState,
} from "./operational-turn.js";
import {
  configurePilotStatePersistence,
  createEmptyPilotState,
  resetPilotConversationStatesForTests as resetStateStore,
  savePilotConversationState,
} from "./conversation-state.js";
import { setOdometerWriteDepsForTests } from "./odometer-turn.js";
import { setCertificateWriteDepsForTests } from "./certificate-turn.js";
import {
  clearSemanticTraces,
  getSemanticTraces,
  semanticTraceStats,
  type SemanticTraceRecord,
} from "./semantic-trace.js";
import type { WaraUnidadEstado } from "./wara-types.js";

process.env.WARA_V2_SEMANTIC_TRACE = "true";

const PHONE = "+5491100000001";
const TENANT = "tenant_trace";
const CONTACTS = [{ id: 1, nombre: "Lab", empresa: "El Cacique" }];

const UNIT_AD: WaraUnidadEstado = {
  movil_id: 137,
  unidad: "M900-137",
  patente: "AD307VS",
  odometro: 120000,
  horometro: 4500,
  ultimo_reporte: { hace_segundos: 120 },
};

const UNIT_AD2: WaraUnidadEstado = {
  movil_id: 138,
  unidad: "M900-138",
  patente: "AD356UQ",
  odometro: 90000,
  horometro: 2100,
  ultimo_reporte: { hace_segundos: 200 },
};

const UNIT_AA: WaraUnidadEstado = {
  movil_id: 100,
  unidad: "M600-001",
  patente: "AA100AA",
  odometro: 150000,
  horometro: 3200,
  ultimo_reporte: { hace_segundos: 300 },
};

let msgSeq = 0;
function mid(s: string) {
  msgSeq += 1;
  return `trace-${s}-${msgSeq}`;
}

async function turn(text: string, id?: string) {
  const r = await resolveOperationalTurn({
    tenantId: TENANT,
    phone: PHONE,
    text,
    messageId: id ?? mid("m"),
    env: {
      WARA_OBTENER_EMPRESA_TOKEN: "x",
      WARA_API_BASE_URL: "http://mock",
      ALLOW_EXTERNAL_MUTATIONS: "false",
      WARA_V2_SEMANTIC_TRACE: "true",
      // Forzar que si hubiera path LLM de búsqueda, no use key real en este diag
      WARA_V2_UTTERANCE_UNDERSTANDING: "false",
    },
    contacts: CONTACTS,
  });
  return r;
}

function seedBase() {
  const st = createEmptyPilotState({ tenantId: TENANT, phone: PHONE, contacts: CONTACTS });
  st.sessionToken = "tok";
  st.selectedContactId = 1;
  st.companyName = "El Cacique";
  st.selectedUnit = {
    movil_id: UNIT_AD.movil_id,
    patente: UNIT_AD.patente!,
    unidad: UNIT_AD.unidad!,
    label: "AD 307 VS (M900-137)",
  };
  st.fleetCache = [UNIT_AD, UNIT_AD2, UNIT_AA];
  st.fleetCacheAt = new Date().toISOString();
  return st;
}

function publicTrace(t: SemanticTraceRecord) {
  return {
    message: t.message,
    normalizedMessage: t.normalizedMessage,
    activeTramite: t.activeTramite,
    activeStep: t.activeStep,
    lastQuestion: t.lastQuestion,
    selectedUnit: t.selectedUnit,
    suspendedTramite: t.suspendedTramite,
    pendingAction: t.pendingAction,
    semanticInterpreterCalled: t.semanticInterpreterCalled,
    ruleSemanticCalled: t.ruleSemanticCalled,
    model: t.model,
    llmCallSite: t.llmCallSite,
    semanticInputSummary: t.semanticInputSummary,
    turnDecision: t.turnDecision,
    semanticOutput: t.semanticOutput,
    deterministicRuleMatchedBeforeSemantic: t.deterministicRuleMatchedBeforeSemantic,
    handlerSelected: t.handlerSelected,
    selectionReason: t.selectionReason,
    replyKind: t.replyKind,
    replyPreview: t.replyPreview,
    stateTransition: t.stateTransition,
    llmCallsInTurn: t.llmCallsInTurn,
  };
}

async function main() {
  resetStateStore();
  resetPilotConversationStatesForTests();
  clearSemanticTraces();
  const tempDir = mkdtempSync(join(tmpdir(), "wara-v2-sem-trace-"));
  configurePilotStatePersistence(join(tempDir, "state.json"));
  setPilotOperationalDepsForTests({
    createToken: async () => ({ ok: true, sessionToken: "tok" }),
    consultarFleet: async () => ({ ok: true, unidades: [UNIT_AD, UNIT_AD2, UNIT_AA] }),
  });
  setOdometerWriteDepsForTests({
    registerReading: async () => ({ ok: true, summary: "dry", payload: {} }),
  });
  setCertificateWriteDepsForTests({
    issue: async () => ({ ok: true, summary: "dry", payload: {} }),
  });

  const cases: Array<{ id: string; setup: () => void | Promise<void>; texts: string[] }> = [];

  // A — Servicio confundido con unidad
  cases.push({
    id: "A_certificado_con_unidad_activa",
    setup: () => {
      const st = seedBase();
      st.activeTramite = "none";
      st.step = "idle";
      savePilotConversationState(st);
    },
    texts: ["quiero un certificado"],
  });

  // B — Cambio ambiguo GPS + no quiero certificado
  cases.push({
    id: "B_gps_no_quiero_certificado",
    setup: () => {
      const st = seedBase();
      st.activeTramite = "await_confirm";
      st.step = "confirm_gps";
      st.pendingConfirmation = {
        action: "gps_report",
        unit: st.selectedUnit!,
        askedAt: new Date().toISOString(),
        question: "¿Querés el reporte GPS de AD 307 VS (M900-137)?",
      };
      st.lastAgentQuestion = st.pendingConfirmation.question;
      savePilotConversationState(st);
    },
    texts: ["no quiero certificado"],
  });

  // C — Cert CONFIRMO + no quiero cambiar odómetro
  cases.push({
    id: "C_cert_no_quiero_cambiar_odometro",
    setup: () => {
      const st = seedBase();
      st.activeTramite = "certificate_issue";
      st.step = "await_confirm";
      st.certificateDraft = {
        unit: st.selectedUnit!,
        step: "await_confirm",
      };
      st.pendingConfirmation = {
        action: "certificate_issue",
        unit: st.selectedUnit!,
        askedAt: new Date().toISOString(),
        question:
          "Puedo solicitar el certificado de cobertura de AD 307 VS.\n¿Querés que lo genere?\n\nSi está correcto, respondé CONFIRMO.",
        operationId: "op-cert-trace",
      };
      st.lastAgentQuestion = st.pendingConfirmation.question;
      savePilotConversationState(st);
    },
    texts: ["no quiero cambiar el odómetro"],
  });

  // D — Fecha incremental horómetro
  cases.push({
    id: "D_horometro_domingo_1130",
    setup: () => {
      const st = seedBase();
      st.activeTramite = "odometer_update";
      st.step = "await_fecha";
      st.odometerDraft = {
        meterType: "horometro",
        unit: st.selectedUnit!,
        valueNew: 4550,
        valuePrevious: 4500,
        fechaLecturaIso: null,
        fechaDisplay: null,
        fechaDatePart: null,
        fechaTimePart: null,
        step: "await_fecha",
      };
      st.lastAgentQuestion = "¿Con qué fecha y hora es la lectura? (ej. 06/08/2026 15:50)";
      savePilotConversationState(st);
    },
    texts: ["el domingo", "11:30"],
  });

  // E — Búsqueda natural
  cases.push({
    id: "E_patente_empieza_con_AD",
    setup: () => {
      const st = seedBase();
      st.selectedUnit = null;
      st.activeTramite = "none";
      st.step = "idle";
      savePilotConversationState(st);
    },
    texts: ["la patente que empieza con AD"],
  });

  const report: Array<{
    caseId: string;
    turns: Array<{ text: string; reply: string; trace: ReturnType<typeof publicTrace> | null }>;
  }> = [];

  for (const c of cases) {
    clearSemanticTraces();
    resetStateStore();
    resetPilotConversationStatesForTests();
    configurePilotStatePersistence(join(tempDir, `${c.id}.json`));
    await c.setup();
    const turns: (typeof report)[0]["turns"] = [];
    for (const text of c.texts) {
      clearSemanticTraces();
      const r = await turn(text, mid(c.id));
      const reply =
        r.kind === "reply" || r.kind === "duplicate" ? r.message : `[llm-fallback kind=${r.kind}]`;
      const traces = getSemanticTraces();
      turns.push({
        text,
        reply: reply.slice(0, 220),
        trace: traces[0] ? publicTrace(traces[0]!) : null,
      });
    }
    report.push({ caseId: c.id, turns });
  }

  // Stats agregados (re-run all in one buffer)
  clearSemanticTraces();
  for (const c of cases) {
    resetStateStore();
    resetPilotConversationStatesForTests();
    configurePilotStatePersistence(join(tempDir, `${c.id}-agg.json`));
    await c.setup();
    for (const text of c.texts) {
      await turn(text, mid(`${c.id}-agg`));
    }
  }
  const stats = semanticTraceStats();

  const out = {
    generatedAt: new Date().toISOString(),
    note:
      "semanticInterpreterCalled = llamada OpenAI real. ruleSemanticCalled = decideTurn/interpretSemanticTurn (reglas).",
    stats,
    cases: report,
  };

  const outPath = join(tempDir, "semantic-trace-report.json");
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  console.error(`\nWrote ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
