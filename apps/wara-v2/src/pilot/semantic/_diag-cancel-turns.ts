/**
 * Diagnóstico local de los 4 turnos rechazados (SHA 80a418d).
 * No mockea TurnDecision — LLM real.
 *
 *   set -a && source ../../.env.local && set +a
 *   WARA_V2_UNIFIED_SEMANTIC_BRAIN=true WARA_V2_SEMANTIC_LIVE=true \
 *     pnpm exec tsx src/pilot/semantic/_diag-cancel-turns.ts
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  resolveOperationalTurn,
  setPilotOperationalDepsForTests,
  resetPilotConversationStatesForTests,
  getPilotConversationState,
} from "../operational-turn.js";
import {
  configurePilotStatePersistence,
  createEmptyPilotState,
  resetPilotConversationStatesForTests as resetStateStore,
  savePilotConversationState,
} from "../conversation-state.js";
import { setCertificateWriteDepsForTests } from "../certificate-turn.js";
import { getLastLabTurnDiagnosis } from "./lab-turn-diagnosis.js";
import type { WaraUnidadEstado } from "../wara-types.js";

const PHONE = "+5491100000CXL";
const TENANT = "tenant_cancel_diag";
const UNITS: WaraUnidadEstado[] = [
  {
    movil_id: 140,
    unidad: "M900-140",
    patente: "AD307VS",
    odometro: 120000,
    horometro: 4500,
    ultimo_reporte: { hace_segundos: 90 },
  },
];

function snapshot(state: ReturnType<typeof getPilotConversationState>) {
  if (!state) return null;
  return {
    activeTramite: state.activeTramite,
    step: state.step,
    pendingConfirmation: state.pendingConfirmation?.action ?? null,
    pendingQuestion: state.pendingConfirmation?.question?.slice(0, 120) ?? null,
    suspendedTramite: state.suspendedTramite?.tramite ?? null,
    certificateDraft: state.certificateDraft?.step ?? null,
    selectedUnit: state.selectedUnit?.label ?? null,
    lastAgentQuestion: state.lastAgentQuestion?.slice(0, 120) ?? null,
  };
}

async function main() {
  const tempDir = mkdtempSync(join(tmpdir(), "wara-cancel-diag-"));
  resetStateStore();
  resetPilotConversationStatesForTests();
  configurePilotStatePersistence(join(tempDir, "state.json"));
  setPilotOperationalDepsForTests({
    createToken: async () => ({ ok: true, sessionToken: "tok" }),
    consultarFleet: async () => ({ ok: true, unidades: UNITS }),
  });
  let certWrites = 0;
  setCertificateWriteDepsForTests({
    issue: async () => {
      certWrites += 1;
      return { ok: true, summary: "dry-cert", payload: {} };
    },
  });

  const st = createEmptyPilotState({ tenantId: TENANT, phone: PHONE });
  st.sessionToken = "tok";
  st.selectedContactId = 1;
  st.companyName = "El Cacique";
  st.selectedUnit = {
    movil_id: 140,
    patente: "AD307VS",
    unidad: "M900-140",
    label: "AD 307 VS (M900-140)",
  };
  st.fleetCache = UNITS;
  st.fleetCacheAt = new Date().toISOString();
  st.activeTramite = "certificate_issue";
  st.certificateDraft = { unit: st.selectedUnit, step: "await_confirm" };
  st.pendingConfirmation = {
    action: "certificate_issue",
    unit: st.selectedUnit,
    askedAt: new Date().toISOString(),
    question:
      "¿Querés continuar con la solicitud del certificado de cobertura o cancelarla?",
  };
  st.lastAgentQuestion = st.pendingConfirmation.question;
  savePilotConversationState(st);

  const messages = ["cancelar", "cancelar", "sí", "osea no quiero certificado"];
  const report: unknown[] = [];
  let seq = 0;

  for (const message of messages) {
    const before = snapshot(getPilotConversationState(TENANT, PHONE));
    const r = await resolveOperationalTurn({
      tenantId: TENANT,
      phone: PHONE,
      text: message,
      messageId: `cx-${++seq}`,
      env: {
        ...process.env,
        WARA_V2_UNIFIED_SEMANTIC_BRAIN: "true",
        ALLOW_EXTERNAL_MUTATIONS: "false",
        WARA_V2_CERTIFICATE_WRITE_ENABLED: "false",
        WARA_OBTENER_EMPRESA_TOKEN: "x",
        WARA_API_BASE_URL: "http://mock",
      },
      contacts: [{ id: 1, nombre: "Lab", empresa: "El Cacique" }],
    });
    const after = snapshot(getPilotConversationState(TENANT, PHONE));
    const diag = getLastLabTurnDiagnosis();
    const reply = r.kind === "reply" || r.kind === "duplicate" ? r.message : r.kind;
    report.push({
      message,
      stateBefore: before,
      llmDecision: {
        action: diag?.action ?? null,
        intent: diag?.intent ?? null,
        answer: (diag as { answer?: string | null } | null)?.answer ?? null,
        currentTramiteDisposition:
          (diag as { currentTramiteDisposition?: string | null } | null)?.currentTramiteDisposition ??
          null,
        reasoningCode: diag?.reasoningCode ?? null,
        confidence: diag?.confidence ?? null,
      },
      policyDecision: diag?.error ?? "ok_or_unknown",
      handler: diag?.handler ?? null,
      stateAfter: after,
      reply,
      rawDiagnosis: diag,
    });
  }

  const out = {
    at: new Date().toISOString(),
    certWrites,
    note: "Reproducción local de la secuencia rechazada con certificado pendiente y pregunta compuesta.",
    turns: report,
  };
  const outPath = join(process.cwd(), "src/pilot/semantic/_diag-cancel-turns.out.json");
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  setPilotOperationalDepsForTests(undefined);
  setCertificateWriteDepsForTests(undefined);
  try {
    rmSync(tempDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
