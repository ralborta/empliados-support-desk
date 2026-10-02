/**
 * Live LLM — aceptación cierre caso / GPS / alarma + confirm write + negativos.
 *
 *   set -a && source ../../.env.local && set +a
 *   WARA_V2_UNIFIED_SEMANTIC_BRAIN=true pnpm exec tsx --test src/pilot/semantic/gps-close.live.test.ts
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
import { CUSTOMER_CLOSE_SUCCESS_MESSAGE } from "../customer-conversation-close.js";
import type { WaraUnidadEstado } from "../wara-types.js";

const LIVE =
  isUnifiedSemanticBrainEnabled(process.env) &&
  Boolean(process.env.OPENAI_API_KEY?.trim()) &&
  process.env.WARA_V2_SEMANTIC_LIVE !== "false";

const PHONE = "+5491100000777";
const TENANT = "tenant_gps_close_live";
const CONTACTS = [
  { id: 1, nombre: "Live", empresa: "El Cacique" },
  { id: 2, nombre: "Live2", empresa: "Roca" },
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
];

let msgSeq = 0;
let tempDir = "";

function mid(s: string) {
  msgSeq += 1;
  return `gps-close-live-${s}-${msgSeq}`;
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
      WARA_V2_CERTIFICATE_WRITE_ENABLED: "false",
      WARA_V2_ODOO_WRITE_ENABLED: "false",
    },
    contacts: CONTACTS,
  });
}

function msgOf(r: Awaited<ReturnType<typeof turn>>): string {
  return r.kind === "reply" || r.kind === "duplicate" ? r.message : `[${r.kind}]`;
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
  savePilotConversationState(st);
  return st;
}

(LIVE ? describe : describe.skip)("live: GPS reporte + cierre caso + alarma", () => {
  beforeEach(() => {
    resetStateStore();
    resetPilotConversationStatesForTests();
    tempDir = mkdtempSync(join(tmpdir(), "wara-v2-gps-close-live-"));
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
    msgSeq = 0;
  });

  afterEach(() => {
    setPilotOperationalDepsForTests(undefined);
    setOdometerWriteDepsForTests(undefined);
    setCertificateWriteDepsForTests(undefined);
    resetStateStore();
    resetPilotConversationStatesForTests();
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it("GPS reporte → pide unidad, no silencio", async () => {
    seedIdle();
    const msg = msgOf(await turn("GPS reporte"));
    assert.match(msg, /patente|unidad|reporte GPS/i);
    assert.ok(msg.trim().length > 0);
    assert.doesNotMatch(msg, /Alarmas|paneles genéricos/i);
  });

  it("Si x favor cierra → confirm_write case_close (no Alarmas, no cancel vacío)", async () => {
    seedIdle();
    let msg = "";
    let st = null as ReturnType<typeof getPilotConversationState>;
    // Aceptación: hasta 2 intentos (varianza LLM en cierre abreviado).
    for (let i = 0; i < 2; i += 1) {
      resetStateStore();
      resetPilotConversationStatesForTests();
      configurePilotStatePersistence(join(tempDir, `state-close-${i}.json`));
      seedIdle();
      msg = msgOf(await turn("Si x favor cierra"));
      st = getPilotConversationState(TENANT, PHONE);
      if (st?.pendingConfirmation?.action === "customer_case_close") break;
    }
    assert.match(msg, /CONFIRMO|cerrar el caso/i);
    assert.doesNotMatch(msg, /No hay un trámite activo|Alarmas|Notificaciones/i);
    assert.equal(st?.pendingConfirmation?.action, "customer_case_close");
  });

  it("CONFIRMO cierre → éxito dry-run, wrote=false", async () => {
    seedIdle();
    await turn("cerrar el caso");
    const st1 = getPilotConversationState(TENANT, PHONE);
    assert.equal(st1?.pendingConfirmation?.action, "customer_case_close");
    const msg = msgOf(await turn("CONFIRMO"));
    assert.equal(msg, CUSTOMER_CLOSE_SUCCESS_MESSAGE);
    const st2 = getPilotConversationState(TENANT, PHONE);
    assert.equal(st2?.pendingConfirmation, null);
    assert.equal(st2?.activeTramite, "none");
  });

  it("Cómo cierro una alarma → domain_knowledge, no case_close", async () => {
    seedIdle();
    const msg = msgOf(await turn("Cómo cierro una alarma"));
    assert.match(msg, /alarma|Notificaciones|Opciones/i);
    assert.doesNotMatch(msg, /CONFIRMO|cerrar el caso\/consulta/i);
    const st = getPilotConversationState(TENANT, PHONE);
    assert.notEqual(st?.pendingConfirmation?.action, "customer_case_close");
  });

  it("negativo: gracias chau idle → no case_close write", async () => {
    seedIdle();
    const msg = msgOf(await turn("gracias chau"));
    assert.ok(msg.trim().length > 0);
    const st = getPilotConversationState(TENANT, PHONE);
    assert.notEqual(st?.pendingConfirmation?.action, "customer_case_close");
    assert.doesNotMatch(msg, /CONFIRMO/);
  });
});
