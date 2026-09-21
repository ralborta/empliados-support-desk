/**
 * Aceptación cerebro semántico unificado — LLM real (sin mock de TurnDecision).
 * Requiere: OPENAI_API_KEY + WARA_V2_UNIFIED_SEMANTIC_BRAIN=true
 *
 *   set -a && source ../../.env.local && set +a
 *   WARA_V2_UNIFIED_SEMANTIC_BRAIN=true pnpm exec tsx --test src/pilot/semantic/unified-brain.live.test.ts
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
} from "../conversation-state.js";
import { setOdometerWriteDepsForTests } from "../odometer-turn.js";
import { setCertificateWriteDepsForTests } from "../certificate-turn.js";
import { isUnifiedSemanticBrainEnabled } from "./brain-flags.js";
import { getLastLabTurnDiagnosis } from "./lab-turn-diagnosis.js";
import type { WaraUnidadEstado } from "../wara-types.js";

const LIVE =
  isUnifiedSemanticBrainEnabled(process.env) &&
  Boolean(process.env.OPENAI_API_KEY?.trim()) &&
  process.env.WARA_V2_SEMANTIC_LIVE !== "false";

const PHONE = "+5491100000099";
const TENANT = "tenant_brain";
const CONTACTS = [
  { id: 1, nombre: "Lab1", empresa: "Empresa Uno" },
  { id: 2, nombre: "Lab2", empresa: "El Cacique" },
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
    movil_id: 138,
    unidad: "M900-138",
    patente: "AD356UQ",
    odometro: 90000,
    horometro: 2100,
    ultimo_reporte: { hace_segundos: 120 },
  },
  {
    movil_id: 100,
    unidad: "M600-001",
    patente: "AA815BB",
    odometro: 150000,
    horometro: 3200,
    ultimo_reporte: { hace_segundos: 200 },
  },
  {
    movil_id: 101,
    unidad: "M600-082",
    patente: "AA820CC",
    odometro: 80000,
    horometro: 1000,
    ultimo_reporte: { hace_segundos: 50 },
  },
];

let msgSeq = 0;
let tempDir = "";
let odoWrites = 0;

function mid(s: string) {
  msgSeq += 1;
  return `brain-${s}-${msgSeq}`;
}

async function turn(text: string) {
  return resolveOperationalTurn({
    tenantId: TENANT,
    phone: PHONE,
    text,
    messageId: mid("t"),
    env: {
      ...process.env,
      WARA_V2_UNIFIED_SEMANTIC_BRAIN: "true",
      WARA_OBTENER_EMPRESA_TOKEN: "x",
      WARA_API_BASE_URL: "http://mock",
      ALLOW_EXTERNAL_MUTATIONS: "false",
      WARA_V2_ODOMETER_WRITE_ENABLED: "false",
    },
    contacts: CONTACTS,
  });
}

function msgOf(r: Awaited<ReturnType<typeof turn>>): string {
  return r.kind === "reply" || r.kind === "duplicate" ? r.message : `[llm:${r.kind}]`;
}

function assertNoLegacyReclass(): void {
  const d = getLastLabTurnDiagnosis();
  assert.ok(d, "lab diagnosis debe registrarse");
  assert.equal(
    d.legacy_text_reclassification_attempted,
    false,
    `reclass residual: ${d.legacy_reclass_reasons.join(",")}`,
  );
}

function seedSelectedAd() {
  const st = createEmptyPilotState({ tenantId: TENANT, phone: PHONE, contacts: CONTACTS });
  st.sessionToken = "tok";
  st.selectedContactId = 2;
  st.companyName = "El Cacique";
  st.selectedUnit = {
    movil_id: 137,
    patente: "AD307VS",
    unidad: "M900-137",
    label: "AD 307 VS (M900-137)",
  };
  st.fleetCache = UNITS;
  st.fleetCacheAt = new Date().toISOString();
  savePilotConversationState(st);
  return st;
}

describe("unified semantic brain — live LLM", { skip: !LIVE }, () => {
  beforeEach(() => {
    msgSeq = 0;
    odoWrites = 0;
    resetStateStore();
    resetPilotConversationStatesForTests();
    tempDir = mkdtempSync(join(tmpdir(), "wara-v2-brain-"));
    configurePilotStatePersistence(join(tempDir, "state.json"));
    setPilotOperationalDepsForTests({
      createToken: async () => ({ ok: true, sessionToken: "tok" }),
      consultarFleet: async () => ({ ok: true, unidades: UNITS }),
    });
    setOdometerWriteDepsForTests({
      registerReading: async () => {
        odoWrites += 1;
        return { ok: true, summary: "DRY-ODO", payload: { simulated: true } };
      },
    });
    setCertificateWriteDepsForTests({
      issue: async () => ({ ok: true, summary: "dry-cert", payload: {} }),
    });
  });

  afterEach(() => {
    setPilotOperationalDepsForTests(undefined);
    setOdometerWriteDepsForTests(undefined);
    setCertificateWriteDepsForTests(undefined);
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("quiero un certificado con unidad activa inicia certificado", async () => {
    seedSelectedAd();
    const msg = msgOf(await turn("quiero un certificado"));
    assert.match(msg, /certificado|CONFIRMO/i);
    assert.doesNotMatch(msg, /No encontré|listado|unidades para/i);
    assertNoLegacyReclass();
  });

  it("GPS pendiente + no quiero certificado → aclara y conserva GPS", async () => {
    const st = seedSelectedAd();
    st.activeTramite = "await_confirm";
    st.pendingConfirmation = {
      action: "gps_report",
      unit: st.selectedUnit!,
      askedAt: new Date().toISOString(),
      question: "¿Querés el reporte GPS de AD 307 VS?",
    };
    st.lastAgentQuestion = st.pendingConfirmation.question;
    savePilotConversationState(st);
    const msg = msgOf(await turn("no quiero certificado"));
    assert.match(msg, /\?/);
    assert.match(msg, /GPS|certificado/i);
    const after = getPilotConversationState(TENANT, PHONE);
    assert.equal(after?.pendingConfirmation?.action, "gps_report");
    assertNoLegacyReclass();
  });

  it("certificado + no quiero cambiar el odómetro → aclara", async () => {
    const st = seedSelectedAd();
    st.activeTramite = "certificate_issue";
    st.certificateDraft = { unit: st.selectedUnit!, step: "await_confirm" };
    st.pendingConfirmation = {
      action: "certificate_issue",
      unit: st.selectedUnit!,
      askedAt: new Date().toISOString(),
      question: "Respondé CONFIRMO para el certificado.",
      operationId: "op1",
    };
    st.lastAgentQuestion = st.pendingConfirmation.question;
    savePilotConversationState(st);
    const msg = msgOf(await turn("no quiero cambiar el odómetro"));
    assert.match(msg, /\?/);
    assert.match(msg, /certificado|od[oó]metro/i);
    assert.equal(getPilotConversationState(TENANT, PHONE)?.pendingConfirmation?.action, "certificate_issue");
    assertNoLegacyReclass();
  });

  it("certificado + quiero cambiar el odómetro → cambia de trámite", async () => {
    const st = seedSelectedAd();
    st.activeTramite = "certificate_issue";
    st.certificateDraft = { unit: st.selectedUnit!, step: "await_confirm" };
    st.pendingConfirmation = {
      action: "certificate_issue",
      unit: st.selectedUnit!,
      askedAt: new Date().toISOString(),
      question: "Respondé CONFIRMO.",
      operationId: "op2",
    };
    savePilotConversationState(st);
    const msg = msgOf(await turn("quiero cambiar el odómetro"));
    assert.match(msg, /od[oó]metro|valor|Pasame|Decime/i);
    assert.doesNotMatch(msg, /CONFIRMO.*certificado|certificado de cobertura/i);
    assertNoLegacyReclass();
  });

  it("horómetro el domingo → 11:30 acumula fecha", async () => {
    const st = seedSelectedAd();
    st.activeTramite = "odometer_update";
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
    st.lastAgentQuestion = "¿Con qué fecha y hora es la lectura?";
    savePilotConversationState(st);
    const d1 = msgOf(await turn("el domingo"));
    assert.match(d1, /hora|domingo|agosto|Perfecto/i);
    const midState = getPilotConversationState(TENANT, PHONE);
    assert.ok(midState?.odometerDraft?.fechaDatePart, "debe conservar fecha");
    const d2 = msgOf(await turn("11:30"));
    assert.match(d2, /CONFIRMO|11:30|Fecha/i);
    assert.ok(getPilotConversationState(TENANT, PHONE)?.odometerDraft?.fechaDatePart);
    assertNoLegacyReclass();
  });

  it("la q empieza con AD lista prefijos", async () => {
    seedSelectedAd();
    const st = getPilotConversationState(TENANT, PHONE)!;
    st.selectedUnit = null;
    savePilotConversationState(st);
    const msg = msgOf(await turn("la q empieza con AD"));
    assert.match(msg, /AD\s*307|AD\s*356|Encontré|unidades/i);
    assertNoLegacyReclass();
  });

  it("conversación obligatoria completa (dry-run)", async () => {
    // empresa
    assert.match(msgOf(await turn("hola")), /empresa|Elegí|1\.|2\./i);
    assert.match(msgOf(await turn("2")), /Cacique|operar|empresa/i);

    const search = msgOf(await turn("la q empieza con AD"));
    assert.match(search, /AD/i);
    assertNoLegacyReclass();

    const pick = msgOf(await turn("AD307VS"));
    assert.match(pick, /GPS|AD\s*307|Querés/i);
    assertNoLegacyReclass();

    const gps = msgOf(await turn("sí"));
    // puede ser reporte o confirmación breve
    assert.ok(gps.length > 5);
    assertNoLegacyReclass();

    const cert = msgOf(await turn("quiero un certificado"));
    assert.match(cert, /certificado|CONFIRMO/i);
    assertNoLegacyReclass();

    const switchOdo = msgOf(await turn("no, mejor quiero cambiar el odómetro"));
    assert.match(switchOdo, /od[oó]metro|valor|Pasame|De acuerdo/i);
    assertNoLegacyReclass();

    const val = msgOf(await turn("130500"));
    assert.match(val, /fecha|hora/i);
    assertNoLegacyReclass();

    const day = msgOf(await turn("el domingo"));
    assert.match(day, /hora|Perfecto|domingo/i);
    assertNoLegacyReclass();

    const time = msgOf(await turn("11:30"));
    assert.match(time, /CONFIRMO|130500|Fecha/i);
    assertNoLegacyReclass();

    const conf = msgOf(await turn("CONFIRMO"));
    assert.match(conf, /Lab|simulat|registr|od[oó]metro|idempotencia|Listo/i);
    assert.equal(odoWrites, 1);
    assertNoLegacyReclass();
  });
});
