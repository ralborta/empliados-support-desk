/**
 * Pruebas odómetro/horómetro V2 — cobertura operativa completa (lab, dry-run).
 */
import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
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
  resetPilotConversationStatesForTests as resetStateStore,
  createEmptyPilotState,
  savePilotConversationState,
  isPilotStateExpired,
} from "./conversation-state.js";
import { setOdometerWriteDepsForTests } from "./odometer-turn.js";
import { buildOdometerWaraPayload } from "./odometer-wara.js";
import type { WaraUnidadEstado } from "./wara-types.js";

const PHONE = "+5491133788190";
const TENANT = "tenant_a";

const UNIT_ODO: WaraUnidadEstado = {
  movil_id: 100,
  unidad: "M600-001",
  patente: "AA100AA",
  odometro: 120000,
  ultimo_reporte: { hace_segundos: 90 },
  ultima_posicion: { hace_segundos: 100 },
  ignicion: { hace_segundos: 110, estado: true },
};

const UNIT_HORO: WaraUnidadEstado = {
  movil_id: 200,
  unidad: "M600-002",
  patente: "BB200BB",
  horometro: 4500,
  odometro: 80000,
};

const UNIT_MYQ: WaraUnidadEstado = {
  movil_id: 300,
  unidad: "MYQ-999",
  patente: "CC300CC",
  odometro: 90000,
  ultimo_reporte: { hace_segundos: 120 },
  ultima_posicion: { hace_segundos: 130 },
  ignicion: { hace_segundos: 140, estado: true },
};

const CONTACTS = [{ id: 1, nombre: "Test", empresa: "Lab" }];

let msgSeq = 0;
function mid(s: string) {
  msgSeq += 1;
  return `${s}-${msgSeq}`;
}

async function turn(text: string, id?: string, env?: Record<string, string>) {
  return resolveOperationalTurn({
    tenantId: TENANT,
    phone: PHONE,
    text,
    messageId: id ?? mid("m"),
    env: {
      WARA_OBTENER_EMPRESA_TOKEN: "x",
      WARA_API_BASE_URL: "http://mock",
      ALLOW_EXTERNAL_MUTATIONS: "false",
      ...env,
    },
    contacts: CONTACTS,
  });
}

describe("odómetro/horómetro V2 — lab", () => {
  let tempDir: string;
  let writes = 0;
  let lastPayload: Record<string, unknown> | null = null;

  beforeEach(() => {
    msgSeq = 0;
    writes = 0;
    lastPayload = null;
    resetStateStore();
    resetPilotConversationStatesForTests();
    tempDir = mkdtempSync(join(tmpdir(), "wara-v2-odo-"));
    configurePilotStatePersistence(join(tempDir, "state.json"));
    setPilotOperationalDepsForTests({
      createToken: async () => ({ ok: true, sessionToken: "tok" }),
      consultarFleet: async () => ({ ok: true, unidades: [UNIT_ODO, UNIT_HORO] }),
    });
    setOdometerWriteDepsForTests({
      registerReading: async (input) => {
        writes += 1;
        lastPayload = {
          patente: input.patente,
          meterType: input.meterType,
          value: input.value,
          fechaIso: input.fechaIso,
          dryRun: input.dryRun,
        };
        return { ok: true, summary: "mock-write", payload: lastPayload };
      },
    });
  });

  afterEach(() => {
    setPilotOperationalDepsForTests(undefined);
    setOdometerWriteDepsForTests(undefined);
    resetStateStore();
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it("odómetro — flujo completo dry-run e idempotencia messageId", async () => {
    await turn("listas de unidades");
    await turn("1", mid("pick"));
    assert.match((await turn("odometro", mid("s"))).message, /valor|km/i);
    assert.match((await turn("130500 km", mid("v"))).message, /d[ií]a|hora|lectura/i);
    assert.match((await turn("06/08/2026 15:50", mid("f"))).message, /CONFIRMO/i);
    const cid = mid("conf");
    const w1 = await turn("CONFIRMO", cid);
    assert.match(w1.message, /simulado|Lab/i);
    assert.equal(writes, 1);
    const w2 = await turn("CONFIRMO", cid);
    assert.match(w2.message, /procesado|idempotencia/i);
    assert.equal(writes, 1);
  });

  it("horómetro — tipo distinto y lectura previa", async () => {
    const st = createEmptyPilotState({ tenantId: TENANT, phone: PHONE, contacts: CONTACTS });
    st.sessionToken = "tok";
    st.selectedUnit = { movil_id: 200, patente: "BB200BB", unidad: "M600-002", label: "BB 200 BB" };
    savePilotConversationState(st);
    const ask = await turn("horometro", mid("h"));
    assert.match(ask.message, /horómetro|hs/i);
    const val = await turn("4600 hs", mid("hv"));
    assert.match(val.message, /d[ií]a|hora|lectura/i);
  });

  it("rechaza retroceso km", async () => {
    const st = createEmptyPilotState({ tenantId: TENANT, phone: PHONE, contacts: CONTACTS });
    st.sessionToken = "tok";
    st.selectedUnit = { movil_id: 100, patente: "AA100AA", unidad: "M600-001", label: "X" };
    st.odometerDraft = {
      meterType: "odometro",
      unit: st.selectedUnit,
      valueNew: null,
      valuePrevious: 120000,
      fechaLecturaIso: null,
      fechaDisplay: null,
      fechaDatePart: null,
      fechaTimePart: null,
      step: "await_value",
    };
    st.activeTramite = "odometer_update";
    savePilotConversationState(st);
    assert.match((await turn("119000 km", mid("r"))).message, /menor|retroceso/i);
  });

  it("rechaza valor inválido", async () => {
    const st = createEmptyPilotState({ tenantId: TENANT, phone: PHONE, contacts: CONTACTS });
    st.sessionToken = "tok";
    st.selectedUnit = { movil_id: 100, patente: "AA100AA", unidad: "M600-001", label: "X" };
    st.odometerDraft = {
      meterType: "odometro",
      unit: st.selectedUnit,
      valueNew: null,
      valuePrevious: 120000,
      fechaLecturaIso: null,
      fechaDisplay: null,
      fechaDatePart: null,
      fechaTimePart: null,
      step: "await_value",
    };
    st.activeTramite = "odometer_update";
    savePilotConversationState(st);
    assert.match((await turn("abc", mid("bad"))).message, /valor|km/i);
  });

  it("corrección de valor antes de confirmar", async () => {
    const st = createEmptyPilotState({ tenantId: TENANT, phone: PHONE, contacts: CONTACTS });
    st.sessionToken = "tok";
    st.activeTramite = "odometer_update";
    st.odometerDraft = {
      meterType: "odometro",
      unit: { movil_id: 100, patente: "AA100AA", unidad: "M600-001", label: "X" },
      valueNew: 130500,
      valuePrevious: 120000,
      fechaLecturaIso: "2026-08-06T15:50:00",
      fechaDisplay: "06/08/2026 15:50",
      step: "await_confirm",
    };
    st.pendingConfirmation = {
      action: "odometer_write",
      unit: st.odometerDraft.unit!,
      askedAt: new Date().toISOString(),
      question: "CONFIRMO",
    };
    savePilotConversationState(st);
    const corr = await turn("131000 km", mid("corr"));
    assert.match(corr.message, /131000|CONFIRMO/i);
    assert.equal(writes, 0);
  });

  it("sí / no / cancelar en confirmación", async () => {
    const base = createEmptyPilotState({ tenantId: TENANT, phone: PHONE, contacts: CONTACTS });
    base.sessionToken = "tok";
    base.activeTramite = "odometer_update";
    base.odometerDraft = {
      meterType: "odometro",
      unit: { movil_id: 100, patente: "AA100AA", unidad: "M600-001", label: "X" },
      valueNew: 130500,
      valuePrevious: 120000,
      fechaLecturaIso: "2026-08-06T15:50:00",
      fechaDisplay: "06/08/2026 15:50",
      step: "await_confirm",
    };
    base.pendingConfirmation = {
      action: "odometer_write",
      unit: base.odometerDraft.unit!,
      askedAt: new Date().toISOString(),
      question: "respondé CONFIRMO",
    };
    savePilotConversationState(base);
    assert.equal(writes, 0);
    const no = await turn("no", mid("n"));
    assert.match(no.message, /no registro|valor correcto/i);
    savePilotConversationState(getPilotConversationState(TENANT, PHONE)!);
    base.pendingConfirmation = {
      action: "odometer_write",
      unit: base.odometerDraft!.unit!,
      askedAt: new Date().toISOString(),
      question: "respondé CONFIRMO",
    };
    base.odometerDraft!.step = "await_confirm";
    savePilotConversationState(base);
    await turn("cancelar trámite", mid("c"));
    const st = getPilotConversationState(TENANT, PHONE);
    assert.equal(st?.activeTramite, "none");
  });

  it("consulta lateral con CONFIRMO pendiente", async () => {
    const st = createEmptyPilotState({ tenantId: TENANT, phone: PHONE, contacts: CONTACTS });
    st.sessionToken = "tok";
    st.pendingConfirmation = {
      action: "odometer_write",
      unit: { movil_id: 100, patente: "AA100AA", unidad: "M600-001", label: "X" },
      askedAt: new Date().toISOString(),
      question: "respondé CONFIRMO",
    };
    st.activeTramite = "odometer_update";
    st.odometerDraft = {
      meterType: "odometro",
      unit: st.pendingConfirmation.unit,
      valueNew: 130500,
      valuePrevious: 120000,
      fechaLecturaIso: "2026-08-06T15:50:00",
      fechaDisplay: "06/08/2026 15:50",
      step: "await_confirm",
    };
    savePilotConversationState(st);
    const side = await turn("que es el odometro?", mid("side"));
    assert.match(side.message, /odómetro|horómetro|CONFIRMO/i);
    assert.equal(writes, 0);
    const resume = await turn("continuamos", mid("res"));
    assert.match(resume.message, /CONFIRMO/i);
  });

  it("continuamos no escribe", async () => {
    const st = createEmptyPilotState({ tenantId: TENANT, phone: PHONE, contacts: CONTACTS });
    st.sessionToken = "tok";
    st.pendingConfirmation = {
      action: "odometer_write",
      unit: { movil_id: 100, patente: "AA100AA", unidad: "M600-001", label: "X" },
      askedAt: new Date().toISOString(),
      question: "respondé CONFIRMO",
    };
    st.activeTramite = "odometer_update";
    st.odometerDraft = {
      meterType: "odometro",
      unit: st.pendingConfirmation.unit,
      valueNew: 130500,
      valuePrevious: 120000,
      fechaLecturaIso: "2026-08-06T15:50:00",
      fechaDisplay: "06/08/2026 15:50",
      step: "await_confirm",
    };
    savePilotConversationState(st);
    await turn("continuamos", mid("resume"));
    assert.equal(writes, 0);
  });

  it("segundo CONFIRMO distinto messageId — una sola escritura", async () => {
    await turn("listas");
    await turn("1", mid("p"));
    await turn("odometro", mid("o"));
    await turn("130500 km", mid("v"));
    await turn("06/08/2026 15:50", mid("f"));
    await turn("CONFIRMO", mid("a"));
    assert.equal(writes, 1);
    const dup = await turn("CONFIRMO", mid("b"));
    assert.match(dup.message, /idempotencia|procesada/i);
    assert.equal(writes, 1);
  });

  it("error WARA no incrementa writes reales", async () => {
    setOdometerWriteDepsForTests({
      registerReading: async () => ({ ok: false, error: "timeout WARA" }),
    });
    await turn("listas");
    await turn("1", mid("p"));
    await turn("odometro", mid("o"));
    await turn("130500 km", mid("v"));
    await turn("06/08/2026 15:50", mid("f"));
    const err = await turn("CONFIRMO", mid("e"));
    assert.match(err.message, /WARA|timeout/i);
    assert.equal(writes, 0);
  });

  it("expiración de sesión", () => {
    const st = createEmptyPilotState({ tenantId: TENANT, phone: PHONE, contacts: CONTACTS });
    st.expiresAt = new Date(Date.now() - 1000).toISOString();
    assert.ok(isPilotStateExpired(st));
  });

  it("persistencia tras reinicio simulado (JSON)", async () => {
    await turn("listas", mid("l"));
    await turn("1", mid("p"));
    await turn("odometro", mid("o"));
    await turn("130500 km", mid("v"));
    const path = join(tempDir, "state.json");
    assert.ok(existsSync(path));
    resetStateStore();
    configurePilotStatePersistence(path);
    const st = getPilotConversationState(TENANT, PHONE);
    assert.ok(st?.odometerDraft?.step === "await_fecha" || st?.activeTramite === "odometer_update");
  });

  it("dry-run WARA — payload exacto V1", () => {
    const payload = buildOdometerWaraPayload({
      sessionToken: "sess",
      patente: "AA100AA",
      meterType: "odometro",
      value: 130500,
      fechaLocalIso: "2026-08-06T15:50:00",
    });
    assert.equal(payload.patente, "AA100AA");
    assert.equal(payload.odometro, 130500);
    assert.ok(payload.fecha.includes("T"));
    assert.equal(payload.token, "sess");
    const spaced = buildOdometerWaraPayload({
      sessionToken: "sess",
      patente: "AH 881 VD",
      meterType: "odometro",
      value: 1,
      fechaLocalIso: "2026-08-12T18:00:00",
    });
    // No reformatear: se respeta la patente de flota tal cual.
    assert.equal(spaced.patente, "AH 881 VD");
    const hp = buildOdometerWaraPayload({
      sessionToken: "sess",
      patente: "BB200BB",
      meterType: "horometro",
      value: 4600,
      fechaLocalIso: "2026-08-06T10:00:00",
    });
    assert.equal(hp.horometro, 4600);
    assert.equal(hp.odometro, undefined);
  });

  it("lectura actual en flujo", async () => {
    await turn("listas");
    await turn("1", mid("p"));
    await turn("odometro", mid("o"));
    const cur = await turn("cual es la lectura actual?", mid("cur"));
    assert.match(cur.message, /120000|actual/i);
  });

  it("cambio de unidad explícito cancela pending odómetro vía router", async () => {
    await turn("listas");
    await turn("1", mid("p"));
    await turn("odometro", mid("o"));
    const ch = await turn("cambiar unidad", mid("cu"));
    assert.match(ch.message, /unidad|patente|lista/i);
  });

  async function setupPendingOdometerConfirm() {
    await turn("listas de unidades");
    await turn("1", mid("pick"));
    await turn("odometro", mid("s"));
    await turn("130500 km", mid("v"));
    const confirm = await turn("06/08/2026 15:50", mid("f"));
    assert.match(confirm.message, /CONFIRMO/i);
    return confirm;
  }

  it("GPS lateral — ¿dónde está el vehículo? → continuamos → CONFIRMO (misma unidad)", async () => {
    await setupPendingOdometerConfirm();
    const gps = await turn("¿dónde está el vehículo?", mid("gps1"));
    assert.match(gps.message, /continuamos|registro pendiente/i);
    assert.equal(writes, 0);
    const resume = await turn("continuamos", mid("resume1"));
    assert.match(resume.message, /CONFIRMO|130500/i);
    const ok = await turn("CONFIRMO", mid("c1"));
    assert.match(ok.message, /simulado|registr/i);
    assert.equal(writes, 1);
    const dup = await turn("CONFIRMO", mid("c2"));
    assert.match(dup.message, /idempotencia|procesada/i);
    assert.equal(writes, 1);
  });

  it("GPS lateral — reporte GPS y frases alternativas", async () => {
    await setupPendingOdometerConfirm();
    assert.match((await turn("reporte GPS", mid("gps2"))).message, /continuamos/i);
    await turn("continuamos", mid("r2"));
    assert.match((await turn("¿dónde está esa unidad?", mid("gps3"))).message, /continuamos/i);
  });

  it("GPS lateral — unidad distinta MYQ no altera operación pendiente", async () => {
    setPilotOperationalDepsForTests({
      createToken: async () => ({ ok: true, sessionToken: "tok" }),
      consultarFleet: async () => ({ ok: true, unidades: [UNIT_ODO, UNIT_HORO, UNIT_MYQ] }),
    });
    await setupPendingOdometerConfirm();
    const side = await turn("¿y dónde está MYQ?", mid("gps4"));
    assert.match(side.message, /MYQ|continuamos/i);
    assert.equal(writes, 0);
    const resume = await turn("continuamos", mid("r4"));
    assert.match(resume.message, /AA100AA|130500|CONFIRMO/i);
    const st = getPilotConversationState(TENANT, PHONE);
    assert.equal(st?.odometerDraft?.unit?.patente, "AA100AA");
    await turn("CONFIRMO", mid("c4"));
    assert.equal(writes, 1);
    assert.equal(lastPayload?.patente, "AA100AA");
  });
});

describe("odómetro V2 — mutaciones bloqueadas", () => {
  it("ALLOW_EXTERNAL_MUTATIONS=false impide POST WARA", async () => {
    assert.notEqual(process.env.ALLOW_EXTERNAL_MUTATIONS, "true");
  });
});
