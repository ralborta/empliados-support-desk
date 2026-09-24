/**
 * Pruebas mantenimiento, certificados, tickets y continuidad entre trámites V2.
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
} from "./conversation-state.js";
import { setMaintenanceWriteDepsForTests } from "./maintenance-turn.js";
import { setCertificateWriteDepsForTests } from "./certificate-turn.js";
import { setTicketWriteDepsForTests } from "./ticket-turn.js";
import { setOdometerWriteDepsForTests } from "./odometer-turn.js";
import { resetOdooTicketIdSeqForTests } from "./odoo-ticket-client.js";
import type { WaraUnidadEstado } from "./wara-types.js";

const PHONE = "+5491133788191";
const TENANT = "tenant_b";

const UNIT: WaraUnidadEstado = {
  movil_id: 101,
  unidad: "M601-001",
  patente: "AA101AA",
  odometro: 150000,
  horometro: 3200,
  ultimo_reporte: { hace_segundos: 300 },
};

const CONTACTS = [{ id: 2, nombre: "Lab2", empresa: "LabCorp" }];

let msgSeq = 0;
function mid(s: string) {
  msgSeq += 1;
  return `${s}-${msgSeq}`;
}

async function turn(text: string, id?: string) {
  return resolveOperationalTurn({
    tenantId: TENANT,
    phone: PHONE,
    text,
    messageId: id ?? mid("m"),
    env: {
      WARA_OBTENER_EMPRESA_TOKEN: "x",
      WARA_API_BASE_URL: "http://mock",
      ALLOW_EXTERNAL_MUTATIONS: "false",
    },
    contacts: CONTACTS,
  });
}

async function selectCompany() {
  await turn("1", mid("co"));
}

describe("mantenimiento / certificados / tickets V2 — lab", () => {
  let tempDir: string;
  let maintWrites = 0;
  let certWrites = 0;
  let ticketWrites = 0;
  let odoWrites = 0;

  beforeEach(() => {
    msgSeq = 0;
    maintWrites = 0;
    certWrites = 0;
    ticketWrites = 0;
    odoWrites = 0;
    resetOdooTicketIdSeqForTests();
    resetStateStore();
    resetPilotConversationStatesForTests();
    tempDir = mkdtempSync(join(tmpdir(), "wara-v2-tram-"));
    configurePilotStatePersistence(join(tempDir, "state.json"));
    setPilotOperationalDepsForTests({
      createToken: async () => ({ ok: true, sessionToken: "tok" }),
      consultarFleet: async () => ({ ok: true, unidades: [UNIT] }),
    });
    setMaintenanceWriteDepsForTests({
      createTicket: async () => {
        maintWrites += 1;
        return { ok: true, summary: "DRY-MAINT", odooPayload: { simulated: true } };
      },
    });
    setCertificateWriteDepsForTests({
      issue: async () => {
        certWrites += 1;
        return { ok: true, summary: "dry-cert", payload: { token: "tok", patente: "AA101AA" } };
      },
    });
    setTicketWriteDepsForTests({
      createTicket: async () => {
        ticketWrites += 1;
        return { ok: true, ref: "DRY-TKT", ticketId: 900001, odooPayload: { simulated: true } };
      },
    });
    setOdometerWriteDepsForTests({
      registerReading: async () => {
        odoWrites += 1;
        return { ok: true, summary: "mock-odo" };
      },
    });
  });

  afterEach(() => {
    setPilotOperationalDepsForTests(undefined);
    setMaintenanceWriteDepsForTests(undefined);
    setCertificateWriteDepsForTests(undefined);
    setTicketWriteDepsForTests(undefined);
    setOdometerWriteDepsForTests(undefined);
    resetStateStore();
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it("mantenimiento — solicitud dry-run e idempotencia CONFIRMO", async () => {
    await selectCompany();
    await turn("quiero solicitar mantenimiento preventivo AA101AA");
    const r1 = await turn("cambio de aceite programado", mid("d1"));
    assert.equal(r1.kind, "reply");
    assert.match(r1.message, /CONFIRMO/);
    const confirmId = "confirm-maint-1";
    const r2 = await turn("CONFIRMO", confirmId);
    assert.equal(r2.kind, "reply");
    assert.match(r2.message, /\[Lab\].*simulada/i);
    assert.equal(maintWrites, 1);
    const r3 = await turn("CONFIRMO", confirmId);
    assert.match(r3.message, /ya fue procesado/i);
    assert.equal(maintWrites, 1);
  });

  it("mantenimiento consulta — datos WARA reales de flota", async () => {
    await selectCompany();
    const r = await turn("consultar mantenimientos vencidos de AA101AA", mid("mc"));
    assert.equal(r.kind, "reply");
    assert.match(r.message, /150000 km/);
    assert.match(r.message, /no expone agenda/i);
  });

  it("certificado — flujo completo dry-run", async () => {
    await selectCompany();
    await turn("necesito certificado de cobertura AA101AA", mid("cert1"));
    const r = await turn("CONFIRMO", mid("certc"));
    assert.equal(r.kind, "reply");
    assert.match(r.message, /\[Lab\].*Certificado simulado/i);
    assert.equal(certWrites, 1);
  });

  it("ticket — derivación humana dry-run", async () => {
    await selectCompany();
    await turn("quiero hablar con un operador", mid("t1"));
    const r1 = await turn("tengo un problema con la facturación del servicio", mid("t2"));
    assert.match(r1.message, /CONFIRMO/);
    const r2 = await turn("CONFIRMO", mid("tc"));
    assert.match(r2.message, /\[Lab\].*Ticket Odoo simulado/i);
    assert.equal(ticketWrites, 1);
  });

  it("continuidad — mantenimiento → GPS → continuamos", async () => {
    await selectCompany();
    await turn("solicitar mantenimiento correctivo AA101AA", mid("m1"));
    await turn("falla en el motor", mid("m2"));
    const gps = await turn("donde esta AA101AA", mid("gps"));
    assert.match(gps.message, /continuamos/i);
    const resume = await turn("continuamos", mid("res"));
    assert.match(resume.message, /CONFIRMO/);
  });

  it("continuidad — certificado → cambio unidad → continuar", async () => {
    await selectCompany();
    await turn("certificado de cobertura", mid("c0"));
    await turn("otra unidad", mid("cu"));
    assert.match((await turn("AA101AA", mid("cu2"))).message, /CONFIRMO/);
  });

  it("continuidad — odómetro → mantenimiento → regresar", async () => {
    await selectCompany();
    await turn("listas de unidades", mid("list"));
    await turn("1", mid("pick"));
    await turn("odometro", mid("o1"));
    await turn("155000", mid("o2"));
    await turn("12/08/2026 10:00", mid("o3"));
    assert.match((await turn("solicitar mantenimiento preventivo", mid("mx"))).message, /detalle|CONFIRMO/i);
    const resume = await turn("continuamos", mid("back"));
    assert.match(resume.message, /CONFIRMO|od[oó]metro|registrar/i);
    const st = getPilotConversationState(TENANT, PHONE);
    assert.ok(st?.pendingConfirmation?.action === "odometer_write");
  });

  it("persistencia tras reinicio — mantenimiento pendiente", async () => {
    await selectCompany();
    await turn("quiero solicitar mantenimiento AA101AA", mid("p1"));
    const r = await turn("preventivo cambio de aceite", mid("p2"));
    assert.match(r.message, /CONFIRMO/);
    const path = join(tempDir, "state.json");
    assert.ok(existsSync(path));
    resetStateStore();
    configurePilotStatePersistence(path);
    const st = getPilotConversationState(TENANT, PHONE);
    assert.equal(st?.pendingConfirmation?.action, "maintenance_write");
  });

  it("dos tenants concurrentes sin contaminación", async () => {
    await resolveOperationalTurn({
      tenantId: "tenant_x",
      phone: PHONE,
      text: "1",
      messageId: mid("x1"),
      env: { WARA_OBTENER_EMPRESA_TOKEN: "x", ALLOW_EXTERNAL_MUTATIONS: "false" },
      contacts: CONTACTS,
    });
    await resolveOperationalTurn({
      tenantId: "tenant_x",
      phone: PHONE,
      text: "certificado AA101AA",
      messageId: mid("x2"),
      env: { WARA_OBTENER_EMPRESA_TOKEN: "x", ALLOW_EXTERNAL_MUTATIONS: "false" },
      contacts: CONTACTS,
    });
    await selectCompany();
    const stA = getPilotConversationState("tenant_x", PHONE);
    const stB = getPilotConversationState(TENANT, PHONE);
    assert.notEqual(stA?.tenantId, stB?.tenantId);
    assert.ok(stB?.companyName);
  });
});
