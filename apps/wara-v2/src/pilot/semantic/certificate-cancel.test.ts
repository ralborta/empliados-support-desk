/**
 * Regresiones de cancelación + decision_conflict (cerebro unificado).
 */
import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
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
  softResetPilotConversation,
  resetPilotConversationLab,
} from "../conversation-state.js";
import { setCertificateWriteDepsForTests } from "../certificate-turn.js";
import { setOdometerWriteDepsForTests } from "../odometer-turn.js";
import { executeTurnDecision } from "./execute-decision.js";
import { applySemanticPolicy } from "./policy-engine.js";
import {
  CANCEL_CERT_REPLY,
  COMPOUND_CHOICE_REPLY,
  shouldUseCancelShortcut,
  mentionsAnotherServiceAlongsideCancel,
} from "./cancel-command.js";
import {
  getDecisionConflictCount,
  resetDecisionConflictCountForTests,
} from "./decision-conflict.js";
import type { TurnDecision } from "./turn-decision-schema.js";
import type { WaraUnidadEstado } from "../wara-types.js";

const PHONE = "+5491100000CXL";
const TENANT = "tenant_cancel_reg";
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

const COMPOUND_Q =
  "¿Querés continuar con la solicitud del certificado de cobertura o cancelarla?";

function seedCertPending(compound = false) {
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
  const q = compound
    ? COMPOUND_Q
    : `Puedo solicitar el certificado de cobertura de AD 307 VS (M900-140).\n¿Querés que lo genere?\n\nSi está correcto, respondé CONFIRMO.`;
  st.pendingConfirmation = {
    action: "certificate_issue",
    unit: st.selectedUnit,
    askedAt: new Date().toISOString(),
    question: q,
  };
  st.lastAgentQuestion = q;
  savePilotConversationState(st);
  return st;
}

let msgSeq = 0;
let certWrites = 0;
let odoWrites = 0;
let tempDir = "";

async function turn(text: string) {
  return resolveOperationalTurn({
    tenantId: TENANT,
    phone: PHONE,
    text,
    messageId: `cx-${++msgSeq}`,
    env: {
      ...process.env,
      WARA_V2_UNIFIED_SEMANTIC_BRAIN: "true",
      WARA_OBTENER_EMPRESA_TOKEN: "x",
      WARA_API_BASE_URL: "http://mock",
      ALLOW_EXTERNAL_MUTATIONS: "false",
      WARA_V2_CERTIFICATE_WRITE_ENABLED: "false",
      WARA_V2_ODOMETER_WRITE_ENABLED: "false",
    },
    contacts: [{ id: 1, nombre: "Lab", empresa: "El Cacique" }],
  });
}

function msgOf(r: Awaited<ReturnType<typeof turn>>): string {
  return r.kind === "reply" || r.kind === "duplicate" ? r.message : `[${r.kind}]`;
}

const execDeps = {
  messageId: "m",
  env: process.env,
  fleetUnits: UNITS,
  originalMessage: "x",
  showListing: () => {},
  askGpsConfirmation: () => "ask",
  deliverGpsReport: () => "gps",
  handleGpsSideQuery: async (i: { state: ReturnType<typeof seedCertPending> }) => ({
    message: "x",
    state: i.state,
  }),
};

describe("certificate cancel regressions (unified brain)", () => {
  beforeEach(() => {
    msgSeq = 0;
    certWrites = 0;
    odoWrites = 0;
    resetDecisionConflictCountForTests();
    resetStateStore();
    resetPilotConversationStatesForTests();
    tempDir = mkdtempSync(join(tmpdir(), "wara-cancel-"));
    configurePilotStatePersistence(join(tempDir, "state.json"));
    setPilotOperationalDepsForTests({
      createToken: async () => ({ ok: true, sessionToken: "tok" }),
      consultarFleet: async () => ({ ok: true, unidades: UNITS }),
    });
    setCertificateWriteDepsForTests({
      issue: async () => {
        certWrites += 1;
        return { ok: true, summary: "dry-cert", payload: {} };
      },
    });
    setOdometerWriteDepsForTests({
      registerReading: async () => {
        odoWrites += 1;
        return { ok: true, summary: "DRY-ODO", payload: { simulated: true } };
      },
    });
  });

  afterEach(() => {
    setPilotOperationalDepsForTests(undefined);
    setCertificateWriteDepsForTests(undefined);
    setOdometerWriteDepsForTests(undefined);
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  for (const phrase of [
    "cancelar",
    "cancelalo",
    "no quiero el certificado",
    "osea no quiero certificado",
    "cancela el certificado",
    "dejá el certificado",
  ]) {
    it(`certificado pendiente → «${phrase}» cancela sin ejecutar`, async () => {
      seedCertPending();
      const msg = msgOf(await turn(phrase));
      assert.equal(msg, CANCEL_CERT_REPLY);
      const after = getPilotConversationState(TENANT, PHONE)!;
      assert.equal(after.pendingConfirmation, null);
      assert.equal(after.certificateDraft, null);
      assert.equal(after.activeTramite, "none");
      assert.equal(after.companyName, "El Cacique");
      assert.ok(after.selectedUnit);
      assert.equal(certWrites, 0);
    });
  }

  it("frase mixta no usa atajo y pasa al cerebro (cancela/suspende e inicia odómetro)", async () => {
    const st = seedCertPending();
    assert.equal(
      mentionsAnotherServiceAlongsideCancel("no quiero el certificado, quiero cambiar el odómetro"),
      true,
    );
    assert.equal(
      shouldUseCancelShortcut("no quiero el certificado, quiero cambiar el odómetro", st),
      false,
    );
    if (!process.env.OPENAI_API_KEY?.trim()) return;
    const msg = msgOf(await turn("no quiero el certificado, quiero cambiar el odómetro"));
    assert.match(msg, /od[oó]metro|valor|Pasame|De acuerdo/i);
    const after = getPilotConversationState(TENANT, PHONE)!;
    assert.notEqual(after.pendingConfirmation?.action, "certificate_issue");
    assert.equal(after.certificateDraft, null);
    assert.equal(certWrites, 0);
  });

  it("answer=confirm + disposition=cancel → decision_conflict, 0 escrituras", async () => {
    const st = seedCertPending();
    const decision: TurnDecision = {
      action: "answer_pending",
      intent: "certificate",
      confidence: 0.9,
      answer: "confirm",
      currentTramiteDisposition: "cancel",
      reasoningCode: "ANSWER_TO_PENDING",
    };
    const beforeConflicts = getDecisionConflictCount();
    const policy = applySemanticPolicy(decision, st);
    assert.equal(policy.ok, false);
    assert.match(policy.reason, /decision_conflict/);
    assert.equal(getDecisionConflictCount(), beforeConflicts + 1);
    const exec = await executeTurnDecision(policy.decision, st, {
      ...execDeps,
      originalMessage: "cancelalo",
    });
    assert.match(exec.message, /\?/);
    assert.equal(st.pendingConfirmation?.action, "certificate_issue");
    assert.ok(st.certificateDraft);
    assert.equal(certWrites, 0);
  });

  it("pregunta compuesta → sí no ejecuta", async () => {
    const st = seedCertPending(true);
    const decision: TurnDecision = {
      action: "answer_pending",
      intent: "certificate",
      confidence: 0.9,
      answer: "confirm",
      currentTramiteDisposition: "keep",
      reasoningCode: "ANSWER_TO_PENDING",
    };
    const exec = await executeTurnDecision(decision, st, {
      ...execDeps,
      originalMessage: "sí",
    });
    assert.equal(exec.message, COMPOUND_CHOICE_REPLY);
    assert.equal(certWrites, 0);
    assert.equal(st.pendingConfirmation?.action, "certificate_issue");
  });

  it("pregunta compuesta → no no ejecuta", async () => {
    const st = seedCertPending(true);
    const decision: TurnDecision = {
      action: "answer_pending",
      intent: "certificate",
      confidence: 0.9,
      answer: "reject",
      currentTramiteDisposition: "keep",
      reasoningCode: "ANSWER_TO_PENDING",
    };
    const exec = await executeTurnDecision(decision, st, {
      ...execDeps,
      originalMessage: "no",
    });
    assert.equal(exec.message, COMPOUND_CHOICE_REPLY);
    assert.equal(certWrites, 0);
  });

  it("pregunta compuesta → continuar conserva", async () => {
    seedCertPending(true);
    const msg = msgOf(await turn("continuar"));
    assert.match(msg, /CONFIRMO|certificado/i);
    const after = getPilotConversationState(TENANT, PHONE)!;
    assert.equal(after.pendingConfirmation?.action, "certificate_issue");
    assert.equal(certWrites, 0);
  });

  it("pregunta compuesta → cancelar cancela", async () => {
    seedCertPending(true);
    const msg = msgOf(await turn("cancelar"));
    assert.equal(msg, CANCEL_CERT_REPLY);
    const after = getPilotConversationState(TENANT, PHONE)!;
    assert.equal(after.pendingConfirmation, null);
    assert.equal(after.certificateDraft, null);
    assert.equal(certWrites, 0);
  });

  it("disposition cancel + answer null → normaliza a cancel", async () => {
    const st = seedCertPending();
    const decision: TurnDecision = {
      action: "answer_pending",
      intent: "certificate",
      confidence: 0.9,
      answer: null,
      currentTramiteDisposition: "cancel",
      reasoningCode: "ANSWER_TO_PENDING",
    };
    const policy = applySemanticPolicy(decision, st);
    assert.equal(policy.ok, true);
    assert.equal(policy.decision.answer, "cancel");
    const exec = await executeTurnDecision(policy.decision, st, execDeps);
    assert.equal(exec.message, CANCEL_CERT_REPLY);
    assert.equal(certWrites, 0);
  });

  it("soft reset limpia pending/draft/historial y conserva empresa/unidad", async () => {
    const st = seedCertPending();
    st.recentTurns = [
      { role: "user", text: "x", at: new Date().toISOString() },
      { role: "assistant", text: "y", at: new Date().toISOString() },
    ];
    savePilotConversationState(st);
    softResetPilotConversation(st);
    savePilotConversationState(st);
    const after = getPilotConversationState(TENANT, PHONE)!;
    assert.equal(after.pendingConfirmation, null);
    assert.equal(after.certificateDraft, null);
    assert.equal(after.recentTurns?.length ?? 0, 0);
    assert.equal(after.companyName, "El Cacique");
    assert.ok(after.selectedUnit);
    const lab = await resetPilotConversationLab(TENANT, PHONE, "soft");
    assert.ok(lab);
    assert.equal(lab.pendingConfirmation, null);
  });

  it("policy reescribe pregunta compuesta a binaria", () => {
    const st = seedCertPending();
    const decision: TurnDecision = {
      action: "clarify",
      intent: "none",
      confidence: 0.45,
      currentTramiteDisposition: "keep",
      reasoningCode: "AMBIGUOUS_NEGATION",
      ambiguity: {
        candidates: ["a", "b"],
        question: "¿Querés cancelar el certificado o continuar?",
      },
    };
    const policy = applySemanticPolicy(decision, st);
    assert.equal(policy.decision.ambiguity?.question, "¿Querés cancelar la solicitud del certificado?");
  });
});
