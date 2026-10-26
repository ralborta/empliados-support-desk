#!/usr/bin/env node
/**
 * E2E P0 memoria/contexto (prod 2026-09-18) vía runTurnExecutorPhase:
 * A. «Fin» con odómetro pendiente cierra; no busca unidad «Fin»
 * B. Tras GPS, «No la veo en mi sistema» no busca «veo» ni reabre odómetro
 * C. «Seguimos en el estado de la unidad» next-step, sin re-dump GPS
 * D. «cambiamos de tema» sale del loop GPS
 * E. Tras GPS + pending odómetro, «M300-80» va a unidades (no al trámite)
 *
 * Uso: npx tsx scripts/verify-kira-memory-p0-e2e.mjs
 */
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";

const PHONE = "5490000001888";
const API_KEY = "test-kira-memory-p0-e2e";

process.env.BUILDERBOT_CONTEXT_API_KEY = API_KEY;
process.env.WARA_UTTERANCE_UNDERSTANDING = "false";
process.env.WARA_AGENT_MODE = "false";
process.env.WARA_TURN_BACKEND_SEND = "false";
process.env.WARA_INBOUND_AUDIT_ONLY = "true";
process.env.WARA_TURN_DEFER_EXECUTOR = "false";
process.env.WARA_DIALOGUE_AI_ODOMETRO = "false";
process.env.WARA_TURN_AI_CLASSIFY = "false";
process.env.WARA_OBTENER_EMPRESA_TOKEN =
  process.env.WARA_OBTENER_EMPRESA_TOKEN || "test-empresa-token";
process.env.WARA_API_BASE_URL = "https://wara.test.local";
process.env.WARA_MAINTENANCE_API_BASE_URL = "https://wara-maint.test.local";
process.env.NODE_ENV = "test";

const GPS_SUMMARY = [
  "El estado GPS de la unidad AH 745 NR es el siguiente:",
  "",
  "📍 *Estado GPS*",
  "🚗 Unidad: *AH 745 NR (M300-080)*",
  "",
  "✅ Funcionamiento normal",
  "Último reporte: hace 1 min",
  "Posición: hace 1 min",
  "Ignición: apagada",
  "📍 Coordenadas: -32.9, -68.8",
  "",
  "¿Seguimos con el estado de la unidad o cambiamos de tema?",
].join("\n");

const pendingOdometer = {
  type: "odometro",
  createdAt: new Date().toISOString(),
  summary: "Odómetro AH 745 NR — pasame km",
  payload: {
    stage: "collecting",
    meterType: "odometro",
    patente: "AH745NR",
    turnLayer: { activeExpectation: "km", pausedExpectation: null, forkPending: false },
  },
};

const activeUnitAh745 = {
  plate: "AH745NR",
  label: "AH 745 NR",
  source: "unidades",
  resolvedAt: new Date().toISOString(),
};

function seedGpsThread() {
  const now = Date.now();
  return [
    {
      id: "m0",
      ticketId: "ticket-kira-p0",
      direction: "INBOUND",
      from: "CUSTOMER",
      text: "estado AH 745 NR",
      createdAt: new Date(now - 120_000),
      rawPayload: {},
    },
    {
      id: "m1",
      ticketId: "ticket-kira-p0",
      direction: "OUTBOUND",
      from: "BOT",
      text: GPS_SUMMARY,
      createdAt: new Date(now - 60_000),
      rawPayload: {},
    },
  ];
}

function createState() {
  const customerData = {
    id: "cust-kira-p0",
    phone: PHONE,
    name: "Kira P0 E2E",
    companyName: "El Cacique S.A.",
    selectedCompanyContactId: 42,
    pendingAction: structuredClone(pendingOdometer),
    activeUnit: structuredClone(activeUnitAh745),
    waraSessionToken: "mock-session-token",
    waraSessionAt: new Date(),
    conversationNotebook: null,
    botPausedAt: null,
  };
  const ticket = {
    id: "ticket-kira-p0",
    customerId: customerData.id,
    status: "OPEN",
    code: "T-KIRA-P0",
    lastMessageAt: new Date(),
    updatedAt: new Date(),
    aiSummary: null,
    resolution: null,
  };
  const messages = seedGpsThread();
  const events = [];

  function reset({ withPending = true } = {}) {
    customerData.pendingAction = withPending ? structuredClone(pendingOdometer) : null;
    customerData.activeUnit = structuredClone(activeUnitAh745);
    customerData.botPausedAt = null;
    ticket.status = "OPEN";
    ticket.resolution = null;
    ticket.lastMessageAt = new Date();
    messages.length = 0;
    messages.push(...seedGpsThread());
    events.length = 0;
  }

  const mockPrisma = {
    customer: {
      findFirst: async () => customerData,
      findUnique: async ({ where, select } = {}) => {
        if (where?.id && where.id !== customerData.id) return null;
        if (where?.phone && String(where.phone) !== PHONE) return null;
        if (select) {
          const out = {};
          for (const [k, v] of Object.entries(select)) {
            if (v) out[k] = customerData[k];
          }
          return out;
        }
        return customerData;
      },
      update: async ({ data }) => {
        Object.assign(customerData, data);
        if (data.pendingAction === Prisma.JsonNull) customerData.pendingAction = null;
        if (data.activeUnit === Prisma.JsonNull) customerData.activeUnit = null;
        return customerData;
      },
    },
    ticket: {
      findFirst: async ({ where } = {}) => {
        if (where?.customerId && where.customerId !== customerData.id) return null;
        if (where?.status?.in && !where.status.in.includes(ticket.status)) return null;
        if (where?.id && where.id !== ticket.id) return null;
        return ticket;
      },
      update: async ({ data }) => {
        Object.assign(ticket, data);
        return ticket;
      },
      count: async () => 0,
    },
    ticketMessage: {
      findMany: async ({ orderBy, take, select } = {}) => {
        const rows = [...messages].sort((a, b) =>
          orderBy?.createdAt === "desc"
            ? b.createdAt - a.createdAt
            : a.createdAt - b.createdAt,
        );
        const sliced = take ? rows.slice(0, take) : rows;
        if (select?.text) return sliced.map((m) => ({ text: m.text }));
        return sliced;
      },
      findFirst: async () => null,
      findUnique: async ({ where }) => messages.find((m) => m.id === where.id) ?? null,
      create: async ({ data }) => {
        const row = {
          id: data.id ?? `msg-${messages.length + 1}`,
          createdAt: new Date(),
          rawPayload: {},
          ...data,
        };
        messages.push(row);
        return row;
      },
      count: async () => messages.length,
    },
    ticketEvent: {
      findFirst: async () => events.at(-1) ?? null,
      create: async ({ data }) => {
        const row = { id: `ev-${events.length + 1}`, createdAt: new Date(), ...data };
        events.push(row);
        return row;
      },
    },
    $queryRaw: async () => [],
    $transaction: async (fn) => fn(mockPrisma),
    $executeRaw: async () => 0,
    $executeRawUnsafe: async () => 0,
    reset,
    getCustomer: () => customerData,
    getTicket: () => ticket,
    getMessages: () => messages,
  };

  return mockPrisma;
}

const mockPrisma = createState();
globalThis.prisma = mockPrisma;

const originalFetch = globalThis.fetch;
let unidadesHits = 0;
let odometroHits = 0;
let fleetSearchBodies = [];

globalThis.fetch = async (input, init) => {
  const url = String(input);
  const bodyText =
    typeof init?.body === "string" ? init.body : init?.body ? String(init.body) : "";

  if (/ObtenerContactosPorNumero/i.test(url)) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        encontrado: true,
        contactos: [{ id: 42, empresa: "El Cacique S.A.", nombre: "Test" }],
        SessionToken: "mock-session-token",
      }),
    };
  }
  if (/CreateChatBotToken|ObtenerEmpresaPorNumero/i.test(url)) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        SessionToken: "mock-session-token",
        CustomerID: 1,
        CustomerName: "El Cacique S.A.",
      }),
    };
  }
  if (/ConsultarEstadoUnidades|ObtenerEstado|ListarUnidades|ObtenerUnidades|ValidarPatente/i.test(url)) {
    unidadesHits += 1;
    fleetSearchBodies.push(bodyText);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        cliente: "El Cacique S.A.",
        unidades: [
          {
            unidad: "M300-080",
            patente: "AH745NR",
            movil_id: 300080,
            ultimo_reporte: { fecha: new Date().toISOString(), hace_segundos: 40 },
            ultima_ignicion: { estado: false, fecha: new Date().toISOString() },
            ultima_posicion: { lat: -32.9, lon: -68.8, fecha: new Date().toISOString() },
          },
        ],
      }),
    };
  }
  if (/odometro|horometro|Actualizar|Registrar/i.test(url)) {
    odometroHits += 1;
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  }
  return { ok: false, status: 404, json: async () => ({ error: "not mocked" }) };
};

const { runTurnExecutorPhase } = await import("../src/lib/whatsappTurnExecutor.ts");
const { classifyTurnExecutor } = await import("../src/lib/whatsappTurnRouter.ts");
const { CUSTOMER_CLOSE_SUCCESS_MESSAGE } = await import(
  "../src/lib/customerConversationCloseDetect.ts"
);

async function turn(text) {
  return runTurnExecutorPhase({
    rawPhone: PHONE,
    selectionText: text,
    apiKey: API_KEY,
  });
}

console.log("=== router Fin → odoo_ticket ===");
assert.equal(classifyTurnExecutor("Fin", GPS_SUMMARY), "odoo_ticket");
assert.notEqual(classifyTurnExecutor("Fin", GPS_SUMMARY), "unidades");

console.log("\n=== A: Fin cierra con odómetro pendiente ===");
{
  mockPrisma.reset({ withPending: true });
  unidadesHits = 0;
  odometroHits = 0;
  const res = await turn("Fin");
  assert.equal(res.executor, "odoo_ticket", `A executor=${res.executor}`);
  assert.match(res.message, /cerr[eé] tu consulta|ya estaba cerrada/i, `A message=${res.message}`);
  assert.doesNotMatch(res.message, /Tomé la referencia Fin|coincida con «Fin»/i);
  assert.equal(unidadesHits, 0, "A no debe consultar flota por «Fin»");
  assert.equal(mockPrisma.getTicket().status, "RESOLVED", "A ticket RESOLVED");
  assert.ok(res.message.includes(CUSTOMER_CLOSE_SUCCESS_MESSAGE.slice(0, 20)));
}

console.log("\n=== B: No la veo en mi sistema (GPS reciente + pending) ===");
{
  mockPrisma.reset({ withPending: true });
  unidadesHits = 0;
  const res = await turn("No la veo en mi sistema");
  assert.equal(res.executor, "unidades", `B executor=${res.executor}`);
  assert.match(res.message, /no la ves en tu sistema/i, `B message=${res.message}`);
  assert.doesNotMatch(res.message, /coincida con «veo»|referencia veo/i);
  assert.doesNotMatch(res.message, /pasame el (valor|nuevo)|CONFIRMO/i);
  assert.equal(unidadesHits, 0, "B no busca flota por «veo»");
}

console.log("\n=== C: Seguimos en el estado — next-step, no re-dump ===");
{
  mockPrisma.reset({ withPending: true });
  unidadesHits = 0;
  const res = await turn("Seguimos en el estado de la unidad");
  assert.equal(res.executor, "unidades", `C executor=${res.executor}`);
  assert.match(res.message, /Seguimos con el estado/i);
  assert.match(res.message, /Qué necesitás ahora/i);
  assert.doesNotMatch(res.message, /Funcionamiento normal|Último reporte|Coordenadas/i);
  assert.equal(unidadesHits, 0, "C no reconsulta GPS");
}

console.log("\n=== D: cambiamos de tema ===");
{
  mockPrisma.reset({ withPending: true });
  unidadesHits = 0;
  const res = await turn("cambiamos de tema");
  assert.equal(res.executor, "info_guides", `D executor=${res.executor}`);
  assert.ok(res.message.trim(), "D debe saludar / menú");
  assert.doesNotMatch(res.message, /Funcionamiento normal|Último reporte/i);
}

console.log("\n=== E: M300-80 tras GPS gana sobre odómetro pendiente ===");
{
  mockPrisma.reset({ withPending: true });
  unidadesHits = 0;
  odometroHits = 0;
  const res = await turn("M300-80");
  assert.equal(res.executor, "unidades", `E executor=${res.executor}`);
  assert.doesNotMatch(res.message, /pasame el (valor|kilometraje)|CONFIRMO para registrarlo/i);
  assert.ok(unidadesHits >= 1, `E debe consultar unidades (hits=${unidadesHits})`);
  assert.equal(odometroHits, 0, "E no dispara escritura odómetro");
  const pending = mockPrisma.getCustomer().pendingAction;
  assert.ok(pending, "E conserva pending write (overlay/contexto GPS, no confirma)");
}

globalThis.fetch = originalFetch;
console.log("\n✓ verify-kira-memory-p0-e2e OK");
