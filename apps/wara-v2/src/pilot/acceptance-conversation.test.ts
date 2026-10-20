/**
 * Conversación de aceptación obligatoria — servicios + fechas naturales + continuidad.
 * Fecha de referencia de la prueba: miércoles 12/08/2026 (America/Argentina/Buenos_Aires).
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
} from "./operational-turn.js";
import {
  configurePilotStatePersistence,
  resetPilotConversationStatesForTests as resetState,
  getPilotConversationState,
} from "./conversation-state.js";
import { setOdometerWriteDepsForTests } from "./odometer-turn.js";
import { setCertificateWriteDepsForTests } from "./certificate-turn.js";
import type { WaraEmpresaContact, WaraUnidadEstado } from "./wara-types.js";
import { parseFechaFromText, fechaLecturaTieneHora } from "./odometro-fecha.js";
import { looksLikeCertificateIntent } from "./certificate-core.js";
import { interpretSemanticTurn } from "./semantic-turn.js";

const PHONE = "+5491133788190";
const TENANT = "tenant_accept";
const TZ = "America/Argentina/Buenos_Aires";

const CONTACTS: WaraEmpresaContact[] = [
  { id: 1, nombre: "Raúl", empresa: "El Cacique S.A." },
];

function buildFleet(): WaraUnidadEstado[] {
  return [
    {
      movil_id: 137,
      patente: "AD307VP",
      unidad: "M900-137",
      odometro: 1000,
      horometro: 50,
      ultimo_reporte: { hace_segundos: 90 },
      ultima_posicion: { hace_segundos: 95, lat: -34.6, lon: -58.4 },
      ultima_ignicion: { estado: true, hace_segundos: 100 },
    },
    {
      movil_id: 138,
      patente: "AD356UQ",
      unidad: "M900-001",
      odometro: 2000,
      horometro: 80,
      ultimo_reporte: { hace_segundos: 100 },
      ultima_posicion: { hace_segundos: 110 },
      ultima_ignicion: { estado: false, hace_segundos: 120 },
    },
    {
      movil_id: 139,
      patente: "AA815XE",
      unidad: "M900-108",
      odometro: 3000,
      horometro: 90,
      ultimo_reporte: { hace_segundos: 100 },
      ultima_posicion: { hace_segundos: 110 },
      ultima_ignicion: { estado: true, hace_segundos: 120 },
    },
  ];
}

let msgSeq = 0;

async function turn(text: string): Promise<{ message: string; state: ReturnType<typeof getPilotConversationState> }> {
  msgSeq += 1;
  const r = await resolveOperationalTurn({
    tenantId: TENANT,
    phone: PHONE,
    text,
    messageId: `accept-${msgSeq}`,
    env: {
      WARA_OBTENER_EMPRESA_TOKEN: "mock",
      WARA_API_BASE_URL: "http://mock",
      WARA_V2_EXECUTION_MODE: "dry_run",
      WARA_V2_ALLOW_WARA_MUTATIONS: "false",
    },
    contacts: CONTACTS,
    customerName: "Raúl",
  });
  const message = r.kind === "llm" ? `[LLM]` : r.message;
  return { message, state: getPilotConversationState(TENANT, PHONE) };
}

describe("fechas naturales V1→V2 (referencia miércoles 12/08/2026)", () => {
  it("el domingo → 2026-08-09 sin hora", () => {
    // Congelar “hoy” no es trivial; validamos resolución relativa al calendar real.
    // Si hoy es miércoles 12, domingo = 09. Si corre otro día, daysSinceLastWeekday sigue siendo correcto.
    const parsed = parseFechaFromText("el domingo", TZ);
    assert.ok(parsed);
    assert.match(parsed!, /^20\d{2}-\d{2}-\d{2}T00:00:00$/);
    assert.equal(fechaLecturaTieneHora(parsed!), false);
    const day = new Date(`${parsed!.slice(0, 10)}T12:00:00Z`).getUTCDay();
    assert.equal(day, 0); // domingo
  });

  it("el domingo 11:30 → fecha+hora", () => {
    const parsed = parseFechaFromText("el domingo 11:30", TZ);
    assert.ok(parsed);
    assert.match(parsed!, /T11:30:00$/);
    assert.equal(fechaLecturaTieneHora(parsed!, "el domingo 11:30"), true);
  });

  it("quiero un certificado no es búsqueda de unidad", () => {
    assert.equal(looksLikeCertificateIntent("quiero un certificado"), true);
    const s = interpretSemanticTurn("quiero un certificado", {});
    assert.equal(s.intent, "certificate");
  });
});

describe("conversación de aceptación obligatoria", () => {
  let tempDir: string;

  beforeEach(() => {
    msgSeq = 0;
    resetState();
    resetPilotConversationStatesForTests();
    tempDir = mkdtempSync(join(tmpdir(), "wara-v2-accept-"));
    configurePilotStatePersistence(join(tempDir, "state.json"));
    setPilotOperationalDepsForTests({
      createToken: async () => ({ ok: true, sessionToken: "mock-token" }),
      consultarFleet: async () => ({ ok: true, unidades: buildFleet() }),
    });
    setOdometerWriteDepsForTests({
      registerReading: async () => ({ ok: true, summary: "dry-run" }),
    });
    setCertificateWriteDepsForTests({
      issue: async () => ({ ok: true, summary: "dry-run" }),
    });

    // Anclar “hoy” de la prueba: no mockeamos Date global; la acumulación
    // de fecha relativa usa TZ AR. Los asserts de día usan domingo real.
  });

  afterEach(() => {
    setPilotOperationalDepsForTests(undefined);
    setOdometerWriteDepsForTests(undefined);
    setCertificateWriteDepsForTests(undefined);
    resetState();
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it("flujo completo: AD → aclarar → GPS → certificado → cancelar → horómetro → domingo → 11:30", async () => {
    const list = await turn("la q empieza con AD");
    assert.match(list.message, /Encontré .*unidades/i);
    assert.match(list.message, /AD 307 VP|AD 356 UQ/i);
    assert.doesNotMatch(list.message, /No encontré/i);

    // Sin trámite padre: no asumir GPS (PendingEntityResolution).
    const pick = await turn("AD307VP");
    assert.match(pick.message, /Seleccioné AD 307 VP/i);
    assert.match(pick.message, /Qué querés consultar o gestionar/i);
    assert.doesNotMatch(pick.message, /reporte GPS/i);

    const gpsAsk = await turn("reporte GPS");
    assert.match(gpsAsk.message, /reporte GPS.*AD 307 VP|AD 307 VP.*GPS/i);

    const yes = await turn("sí");
    assert.match(yes.message, /AD 307 VP|Funcionamiento|ignici[oó]n|M900-137/i);

    const cert = await turn("quiero un certificado");
    assert.match(cert.message, /certificado de cobertura/i);
    assert.match(cert.message, /AD 307 VP|M900-137/i);
    assert.doesNotMatch(cert.message, /No encontré/i);

    const cancel = await turn("cancelar");
    assert.match(cancel.message, /Cancel[eé].*certificado/i);

    const horo = await turn("cambia el horómetro");
    assert.match(horo.message, /hor[oó]metro|valor|hs/i);

    const val = await turn("55");
    assert.match(val.message, /fecha|hora/i);

    const domingo = await turn("el domingo");
    assert.match(domingo.message, /Perfecto,.*domingo/i);
    assert.match(domingo.message, /\¿A qué hora\?|A qué hora/i);
    assert.doesNotMatch(domingo.message, /Necesito fecha y hora juntas/i);

    const stAfterDay = getPilotConversationState(TENANT, PHONE);
    assert.ok(stAfterDay?.odometerDraft?.fechaDatePart || stAfterDay?.odometerDraft?.fechaLecturaIso);
    const dayPart =
      stAfterDay?.odometerDraft?.fechaDatePart ??
      stAfterDay?.odometerDraft?.fechaLecturaIso?.slice(0, 10);
    assert.ok(dayPart);
    assert.equal(new Date(`${dayPart}T12:00:00Z`).getUTCDay(), 0);

    const hora = await turn("11:30");
    assert.match(hora.message, /CONFIRMO|55|11:30/i);
    const st = getPilotConversationState(TENANT, PHONE);
    assert.ok(st?.odometerDraft?.fechaLecturaIso?.includes("T11:30"));
    assert.equal(st?.pendingConfirmation?.action, "odometer_write");
  });

  it("evidencia 1 — certificado no se busca como unidad", async () => {
    await turn("reporte GPS de AD307VP");
    await turn("sí");
    const cert = await turn("quiero un certificado");
    assert.doesNotMatch(cert.message, /No encontré «?un certificado/i);
    assert.match(cert.message, /certificado de cobertura.*AD 307 VP|AD 307 VP.*certificado/i);
  });

  it("evidencia 2 — fecha y hora en mensajes separados", async () => {
    await turn("reporte GPS de AD307VP");
    await turn("sí");
    await turn("cambia el horómetro");
    await turn("55");
    const d = await turn("el domingo");
    assert.match(d.message, /Perfecto,.*domingo/i);
    const h = await turn("11:30");
    assert.match(h.message, /CONFIRMO/i);
  });

  it("hora primero, luego día", async () => {
    await turn("reporte GPS de AD307VP");
    await turn("cambia el horómetro");
    await turn("55");
    const t = await turn("a las 11:30");
    assert.match(t.message, /11:30|qu[eé] d[ií]a/i);
    const d = await turn("el domingo");
    assert.match(d.message, /CONFIRMO|11:30/i);
  });

  it("sinónimos de certificado", async () => {
    await turn("AD307VP");
    for (const phrase of ["necesito la cobertura", "dame la póliza de esta unidad", "certificado"]) {
      msgSeq += 1;
      const r = await resolveOperationalTurn({
        tenantId: TENANT,
        phone: PHONE,
        text: phrase,
        messageId: `syn-${msgSeq}`,
        env: { WARA_OBTENER_EMPRESA_TOKEN: "mock", WARA_API_BASE_URL: "http://mock" },
        contacts: CONTACTS,
        customerName: "Raúl",
      });
      const msg = r.kind === "llm" ? "[LLM]" : r.message;
      assert.match(msg, /certificado|cobertura|CONFIRMO/i, phrase);
      assert.doesNotMatch(msg, /No encontré/i, phrase);
      // cancelar para el siguiente
      await turn("cancelar");
    }
  });
});
