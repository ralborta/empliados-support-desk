/**
 * GPS lectura directa, confirmación heredada, saludo y anti-plantilla genérica.
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
import { commitSelectedUnit } from "./unit-context.js";
import { continueAfterUnitResolved } from "./pending-entity-resolution.js";
import { executeTurnDecision } from "./execute-decision.js";
import type { WaraUnidadEstado } from "../wara-types.js";

const TENANT = "tenant_gps_direct";
const PHONE = "+5491100000GPSD";

const UNIT: WaraUnidadEstado = {
  movil_id: 135,
  unidad: "M900-135",
  patente: "AD307VQ",
  odometro: 1000,
  horometro: 10,
  ultimo_reporte: { hace_segundos: 90 },
  ultima_posicion: { hace_segundos: 100 },
};

let tempDir = "";
let msgSeq = 0;

async function turn(
  text: string,
  opts?: { contacts?: Array<{ id: number; nombre: string; empresa: string }> },
) {
  msgSeq += 1;
  return resolveOperationalTurn({
    tenantId: TENANT,
    phone: PHONE,
    text,
    messageId: `gpsd-${msgSeq}`,
    env: {
      ...process.env,
      WARA_V2_UNIFIED_SEMANTIC_BRAIN: "true",
      WARA_OBTENER_EMPRESA_TOKEN: "x",
      WARA_API_BASE_URL: "http://mock",
      ALLOW_EXTERNAL_MUTATIONS: "false",
    },
    contacts: opts?.contacts ?? [{ id: 1, nombre: "Raúl", empresa: "El Cacique" }],
    customerName: "Raúl",
  });
}

function msgOf(r: Awaited<ReturnType<typeof turn>>): string {
  return r.kind === "reply" || r.kind === "duplicate" ? r.message : `[${r.kind}]`;
}

function seedActive() {
  const st = createEmptyPilotState({
    tenantId: TENANT,
    phone: PHONE,
    contacts: [{ id: 1, nombre: "Raúl", empresa: "El Cacique" }],
  });
  st.sessionToken = "tok";
  st.selectedContactId = 1;
  st.companyName = "El Cacique";
  st.fleetCache = [UNIT];
  st.fleetCacheAt = new Date().toISOString();
  commitSelectedUnit(st, UNIT, "explicit_plate");
  st.conversationMetadata = { greetedAt: new Date().toISOString(), introducedAtilio: true };
  savePilotConversationState(st);
  return st;
}

describe("GPS lectura directa + saludo + anti-genérico", () => {
  beforeEach(() => {
    msgSeq = 0;
    resetStateStore();
    resetPilotConversationStatesForTests();
    tempDir = mkdtempSync(join(tmpdir(), "wara-v2-gpsd-"));
    configurePilotStatePersistence(join(tempDir, "state.json"));
    setPilotOperationalDepsForTests({
      createToken: async () => ({ ok: true, sessionToken: "tok" }),
      consultarFleet: async () => ({ ok: true, unidades: [UNIT] }),
    });
  });

  afterEach(() => {
    setPilotOperationalDepsForTests(undefined);
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("continueAfterUnitResolved gps entrega reporte sin preguntar", () => {
    const st = seedActive();
    const cont = continueAfterUnitResolved(st, UNIT, { parentIntent: "gps" });
    assert.match(cont.message, /AD 307 VQ|Funcionamiento|reporte|posición|posicion/i);
    assert.doesNotMatch(cont.message, /Querés el reporte GPS/i);
    assert.equal(st.pendingConfirmation, null);
  });

  it("unidad activa → dame su estado → reporte directo", async () => {
    seedActive();
    const msg = msgOf(await turn("dame su estado"));
    assert.match(msg, /AD 307 VQ|Funcionamiento|reporte|posición|posicion|señal|senal/i);
    assert.doesNotMatch(msg, /Querés el reporte GPS|Recibí el dato/i);
  });

  it("unidad activa → me das el reporte → reporte directo", async () => {
    seedActive();
    const msg = msgOf(await turn("me das el reporte?"));
    assert.match(msg, /AD 307 VQ|Funcionamiento|reporte|posición|posicion/i);
    assert.doesNotMatch(msg, /Querés el reporte GPS|Recibí el dato/i);
  });

  it("GPS pendiente heredado → sí → reporte", async () => {
    const st = seedActive();
    st.activeTramite = "await_confirm";
    st.pendingConfirmation = {
      action: "gps_report",
      unit: st.selectedUnit!,
      askedAt: new Date().toISOString(),
      question: "¿Querés el reporte GPS de AD 307 VQ?",
    };
    st.lastAgentQuestion = st.pendingConfirmation.question;
    savePilotConversationState(st);
    const msg = msgOf(await turn("sí"));
    assert.match(msg, /AD 307 VQ|Funcionamiento|reporte|posición|posicion/i);
    assert.doesNotMatch(msg, /Recibí el dato|Querés el reporte/i);
    assert.equal(getPilotConversationState(TENANT, PHONE)?.pendingConfirmation, null);
  });

  it("GPS pendiente → dale → reporte", async () => {
    const st = seedActive();
    st.pendingConfirmation = {
      action: "gps_report",
      unit: st.selectedUnit!,
      askedAt: new Date().toISOString(),
      question: "¿Querés el reporte GPS de AD 307 VQ?",
    };
    savePilotConversationState(st);
    const msg = msgOf(await turn("dale"));
    assert.match(msg, /AD 307 VQ|Funcionamiento|reporte|posición|posicion/i);
  });

  it("GPS pendiente → no → cancela solo la consulta", async () => {
    const st = seedActive();
    st.pendingConfirmation = {
      action: "gps_report",
      unit: st.selectedUnit!,
      askedAt: new Date().toISOString(),
      question: "¿Querés el reporte GPS de AD 307 VQ?",
    };
    savePilotConversationState(st);
    const msg = msgOf(await turn("no"));
    assert.match(msg, /cancel|GPS|ayud/i);
    assert.equal(getPilotConversationState(TENANT, PHONE)?.pendingConfirmation, null);
  });

  it("tres pedidos de reporte no caen en plantilla genérica", async () => {
    seedActive();
    for (const t of ["si me das su estado?", "me das el reporte?", "el reporte de la unidad"]) {
      const msg = msgOf(await turn(t));
      assert.doesNotMatch(msg, /Recibí el dato/i);
      assert.doesNotMatch(msg, /Querés el reporte GPS/i);
      assert.match(msg, /AD 307 VQ|Funcionamiento|reporte|posición|posicion|señal|senal/i);
    }
  });

  it("provide_fields genérico no usa plantilla vacía", async () => {
    const st = seedActive();
    const r = await executeTurnDecision(
      {
        action: "provide_fields",
        intent: "none",
        confidence: 0.5,
        currentTramiteDisposition: "keep",
        reasoningCode: "PROVIDED_MISSING_FIELD",
      },
      st,
      {
        messageId: "pf1",
        env: process.env,
        fleetUnits: [UNIT],
        originalMessage: "sí",
        showListing: () => undefined,
        askGpsConfirmation: () => "ASK",
        deliverGpsReport: () => "GPS_DELIVERED",
        handleGpsSideQuery: async ({ state }) => ({ message: "side", state }),
      },
    );
    assert.doesNotMatch(r.message, /Recibí el dato/i);
    assert.match(r.message, /dato|trámite|Decime/i);
  });

  it("primer contacto hola → presentación Atilio + empresas", async () => {
    const contacts = [
      { id: 1, nombre: "A", empresa: "WARA" },
      { id: 2, nombre: "B", empresa: "El Cacique" },
    ];
    const st = createEmptyPilotState({
      tenantId: TENANT,
      phone: PHONE,
      contacts,
    });
    savePilotConversationState(st);
    const msg = msgOf(await turn("hola", { contacts }));
    assert.match(msg, /Atilio/i);
    assert.match(msg, /empresa|1\.|2\./i);
    assert.equal(getPilotConversationState(TENANT, PHONE)?.conversationMetadata.introducedAtilio, true);
  });

  it("sesión activa → hola → saludo breve", async () => {
    seedActive();
    const msg = msgOf(await turn("hola"));
    assert.match(msg, /Hola/i);
    assert.doesNotMatch(msg, /soy Atilio/i);
  });

  it("trámite pendiente → hola → saludo + resumen", async () => {
    const st = seedActive();
    st.activeTramite = "certificate_issue";
    st.pendingConfirmation = {
      action: "certificate_issue",
      unit: st.selectedUnit!,
      askedAt: new Date().toISOString(),
      question: "¿CONFIRMO?",
    };
    savePilotConversationState(st);
    const msg = msgOf(await turn("hola"));
    assert.match(msg, /Hola/i);
    assert.match(msg, /pendiente|certificado/i);
  });
});
