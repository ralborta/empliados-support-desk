/**
 * Diagnóstico local de los dos turnos fallidos (sin deploy).
 * Ejecutar: pnpm exec tsx src/pilot/_diag-negation-turns.ts
 */
import {
  resolveOperationalTurn,
  setPilotOperationalDepsForTests,
  resetPilotConversationStatesForTests,
} from "./operational-turn.js";
import {
  configurePilotStatePersistence,
  createEmptyPilotState,
  getPilotConversationState,
  resetPilotConversationStatesForTests as resetState,
  savePilotConversationState,
} from "./conversation-state.js";
import { looksLikeCertificateIntent, looksLikeCancelCertificate } from "./certificate-core.js";
import { looksLikeOdometerIntent, looksLikeCancelOdometer } from "./odometer-core.js";
import { looksLikeCertificateService, looksLikeOdometerOrHorometerService, classifyServiceIntent } from "./service-catalog.js";
import { interpretSemanticTurn } from "./semantic-turn.js";
import { looksLikeBriefRejection, looksLikeBriefConfirmation, looksLikeCancelTramite } from "./brief-replies.js";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const PHONE = "+5491133788190";
const TENANT = "diag";
const UNIT = {
  movil_id: 137,
  patente: "AD307VS",
  unidad: "M900-137",
  label: "AD 307 VS (M900-137)",
};

const FLEET = [
  {
    movil_id: 137,
    patente: "AD307VS",
    unidad: "M900-137",
    odometro: 1000,
    horometro: 50,
    ultimo_reporte: { hace_segundos: 90 },
    ultima_posicion: { hace_segundos: 95 },
    ultima_ignicion: { estado: true, hace_segundos: 100 },
  },
];

function detectors(text: string) {
  return {
    looksLikeCertificateService: looksLikeCertificateService(text),
    looksLikeCertificateIntent: looksLikeCertificateIntent(text),
    looksLikeCancelCertificate: looksLikeCancelCertificate(text),
    looksLikeOdometerOrHorometerService: looksLikeOdometerOrHorometerService(text),
    looksLikeOdometerIntent: looksLikeOdometerIntent(text),
    looksLikeCancelOdometer: looksLikeCancelOdometer(text),
    looksLikeBriefRejection: looksLikeBriefRejection(text),
    looksLikeBriefConfirmation: looksLikeBriefConfirmation(text),
    looksLikeCancelTramite: looksLikeCancelTramite(text),
    classifyServiceIntent: classifyServiceIntent(text),
  };
}

function snapshot(label: string) {
  const st = getPilotConversationState(TENANT, PHONE);
  return {
    label,
    activeTramite: st?.activeTramite,
    step: st?.step,
    pendingAction: st?.pendingConfirmation?.action ?? null,
    pendingQuestion: st?.pendingConfirmation?.question ?? null,
    selectedUnit: st?.selectedUnit?.label ?? null,
    certificateStep: st?.certificateDraft?.step ?? null,
    odometerStep: st?.odometerDraft?.step ?? null,
    lastAgentQuestion: st?.lastAgentQuestion ?? null,
  };
}

async function turn(text: string, messageId: string) {
  const before = snapshot("before");
  const dets = detectors(text);
  const semantic = interpretSemanticTurn(text, {
    activeTramite: before.activeTramite,
    selectedUnit: getPilotConversationState(TENANT, PHONE)?.selectedUnit,
    lastAgentQuestion: before.lastAgentQuestion,
  });

  const r = await resolveOperationalTurn({
    tenantId: TENANT,
    phone: PHONE,
    text,
    messageId,
    env: {
      WARA_OBTENER_EMPRESA_TOKEN: "mock",
      WARA_API_BASE_URL: "http://mock",
      WARA_V2_EXECUTION_MODE: "dry_run",
      WARA_V2_ALLOW_WARA_MUTATIONS: "false",
    },
    contacts: [{ id: 1, nombre: "Raúl", empresa: "El Cacique S.A." }],
    customerName: "Raúl",
  });

  const after = snapshot("after");
  return {
    text,
    messageNormalized: text
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim(),
    before,
    detectors: dets,
    semantic,
    reply: r.kind === "llm" ? "[LLM]" : r.message,
    after,
  };
}

async function main() {
  resetState();
  resetPilotConversationStatesForTests();
  const dir = mkdtempSync(join(tmpdir(), "diag-neg-"));
  configurePilotStatePersistence(join(dir, "s.json"));
  setPilotOperationalDepsForTests({
    createToken: async () => ({ ok: true, sessionToken: "t" }),
    consultarFleet: async () => ({ ok: true, unidades: FLEET }),
  });

  // ——— Caso 1: GPS pendiente + "no quiero certificado" ———
  {
    const st = createEmptyPilotState({
      tenantId: TENANT,
      phone: PHONE,
      contacts: [{ id: 1, nombre: "Raúl", empresa: "El Cacique S.A." }],
      customerName: "Raúl",
    });
    st.selectedContactId = 1;
    st.companyName = "El Cacique S.A.";
    st.sessionToken = "t";
    st.selectedUnit = UNIT;
    st.activeTramite = "await_confirm";
    st.step = "confirm_gps";
    st.pendingConfirmation = {
      action: "gps_report",
      unit: UNIT,
      askedAt: new Date().toISOString(),
      question: "¿Querés el reporte GPS de AD 307 VS (M900-137)?",
    };
    st.lastAgentQuestion = st.pendingConfirmation.question;
    savePilotConversationState(st);

    const t1 = await turn("no quiero certificado", "diag-1");
    console.log("\n========== CASO 1: GPS pendiente + «no quiero certificado» ==========");
    console.log(JSON.stringify(t1, null, 2));
  }

  // ——— Caso 2: certificado pendiente + "no quiero cambiar el odómetro" ———
  {
    resetState();
    resetPilotConversationStatesForTests();
    configurePilotStatePersistence(join(dir, "s2.json"));
    const st = createEmptyPilotState({
      tenantId: TENANT,
      phone: PHONE,
      contacts: [{ id: 1, nombre: "Raúl", empresa: "El Cacique S.A." }],
      customerName: "Raúl",
    });
    st.selectedContactId = 1;
    st.companyName = "El Cacique S.A.";
    st.sessionToken = "t";
    st.selectedUnit = UNIT;
    st.activeTramite = "certificate_issue";
    st.step = "await_confirm";
    st.certificateDraft = { unit: UNIT, step: "await_confirm" };
    st.pendingConfirmation = {
      action: "certificate_issue",
      unit: UNIT,
      askedAt: new Date().toISOString(),
      question:
        "Puedo solicitar el certificado de cobertura de AD 307 VS (M900-137).\n¿Querés que lo genere?\n\nSi está correcto, respondé CONFIRMO.",
    };
    st.lastAgentQuestion = st.pendingConfirmation.question;
    savePilotConversationState(st);

    const t2a = await turn("no quiero cambiar el odómetro", "diag-2a");
    console.log("\n========== CASO 2a: cert pendiente + «no quiero cambiar el odómetro» ==========");
    console.log(JSON.stringify(t2a, null, 2));

    const t2b = await turn("quiero cambiar el odómetro", "diag-2b");
    console.log("\n========== CASO 2b: luego «quiero cambiar el odómetro» ==========");
    console.log(JSON.stringify(t2b, null, 2));
  }

  // Variantes ambiguas
  console.log("\n========== DETECTORES DE VARIANTES ==========");
  for (const phrase of [
    "no quiero certificado",
    "no, quiero certificado",
    "no quiero el certificado",
    "no quiero cambiar el odómetro",
    "no, quiero cambiar el odómetro",
    "quiero cambiar el odómetro",
    "mejor cambia el odómetro",
    "dejá eso, necesito informar kilómetros",
  ]) {
    console.log(phrase, "→", detectors(phrase));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
