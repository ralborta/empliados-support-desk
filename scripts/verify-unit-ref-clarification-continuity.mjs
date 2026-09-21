#!/usr/bin/env node
/**
 * Continuidad XOR unit_reference → pendingClarification con unitRef.
 *
 * 1) trámite → aclaración 900121 → "GPS" → consulta exactamente 900121
 * 2) trámite → aclaración 900121 → "es el dato del trámite" → retoma odómetro
 *
 * Uso: npx tsx scripts/verify-unit-ref-clarification-continuity.mjs
 */
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";

const PHONE = "5490000000777";
const API_KEY = "test-unit-ref-clarification";

process.env.BUILDERBOT_CONTEXT_API_KEY = API_KEY;
process.env.WARA_UTTERANCE_UNDERSTANDING = "false";
process.env.WARA_AGENT_MODE = "false";
process.env.WARA_TURN_BACKEND_SEND = "false";
process.env.WARA_INBOUND_AUDIT_ONLY = "true";
process.env.WARA_TURN_DEFER_EXECUTOR = "false";
process.env.WARA_DIALOGUE_AI_ODOMETRO = "false";
process.env.WARA_OBTENER_EMPRESA_TOKEN =
  process.env.WARA_OBTENER_EMPRESA_TOKEN || "test-empresa-token";
process.env.WARA_API_BASE_URL = "https://wara.test.local";
process.env.WARA_MAINTENANCE_API_BASE_URL = "https://wara-maint.test.local";
process.env.NODE_ENV = "test";

const basePending = {
  type: "odometro",
  createdAt: new Date().toISOString(),
  summary: "Horómetro NKL 952",
  payload: {
    stage: "collecting",
    meterKind: "horometro",
    plate: "NKL952",
    patente: "NKL952",
    turnLayer: { activeExpectation: "km", pausedExpectation: null, forkPending: false },
  },
};

const customerData = {
  id: "cust-unit-ref-clarify",
  phone: PHONE,
  name: "Test Clarify",
  companyName: "El Cacique S.A.",
  selectedCompanyContactId: 42,
  pendingAction: null,
  activeUnit: null,
  waraSessionToken: "mock-session-token",
  waraSessionAt: new Date(),
  conversationNotebook: null,
};

const ticket = {
  id: "ticket-unit-ref-clarify",
  customerId: customerData.id,
  status: "OPEN",
  lastMessageAt: new Date(),
};

const messages = [];

const mockPrisma = {
  customer: {
    findFirst: async () => customerData,
    findUnique: async ({ where } = {}) => {
      if (where?.phone && String(where.phone) !== PHONE) return null;
      return customerData;
    },
    update: async ({ data }) => {
      if (data.pendingAction !== undefined) {
        customerData.pendingAction =
          data.pendingAction === Prisma.JsonNull ? null : data.pendingAction;
      }
      if (data.activeUnit !== undefined) {
        customerData.activeUnit =
          data.activeUnit === Prisma.JsonNull ? null : data.activeUnit;
      }
      return customerData;
    },
  },
  ticket: {
    findFirst: async () => ticket,
    update: async () => ticket,
  },
  ticketMessage: {
    findMany: async () => [...messages].sort((a, b) => a.createdAt - b.createdAt),
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
  $queryRaw: async () => [],
  $transaction: async (fn) => fn(mockPrisma),
  $executeRaw: async () => 0,
  $executeRawUnsafe: async () => 0,
};

// Bind mock BEFORE any lib import that carga db (turnLayer/understanding lo hacen).
globalThis.prisma = mockPrisma;

const {
  buildUnitRefClarificationTurnLayer,
  classifyUnitRefClarificationChoice,
  readPendingClarification,
  readTurnLayer,
  clearClarificationRestoreExpectation,
} = await import("../src/lib/turnLayerContract.ts");

const { buildUnitReferenceClarifyReply } = await import(
  "../src/lib/utteranceUnderstanding.ts"
);

console.log("=== Helpers XOR unit_ref clarification ===");
assert.equal(classifyUnitRefClarificationChoice("GPS"), "status");
assert.equal(classifyUnitRefClarificationChoice("es el dato del trámite"), "continue");
assert.equal(classifyUnitRefClarificationChoice("tal vez"), "ambiguous");
assert.equal(classifyUnitRefClarificationChoice("cancelar"), "cancel");

const clarifyLayer = buildUnitRefClarificationTurnLayer(
  "Pasame el nuevo horómetro en horas",
  basePending,
  { kind: "unit_name", value: "900121" },
);
assert.equal(clarifyLayer.activeExpectation, "clarification");
assert.equal(clarifyLayer.pausedExpectation, "km");
assert.equal(clarifyLayer.forkPending, false);
assert.equal(clarifyLayer.pendingClarification?.unitRef.value, "900121");

const clarifyMsg = buildUnitReferenceClarifyReply({
  referent: "vehicle_unit",
  confidence: 0.95,
  clarifyQuestion: null,
  action: "unit_reference",
  unitRef: { kind: "unit_name", value: "900121" },
});
assert.match(clarifyMsg, /900121/);
assert.match(clarifyMsg, /estado|GPS|trámite/i);

function resetClarificationState() {
  messages.length = 0;
  messages.push(
    {
      id: "m0",
      ticketId: ticket.id,
      direction: "INBOUND",
      from: "CUSTOMER",
      text: "Ok ahora cambio de horometro",
      createdAt: new Date(Date.now() - 120_000),
      rawPayload: {},
    },
    {
      id: "m1",
      ticketId: ticket.id,
      direction: "OUTBOUND",
      from: "BOT",
      text: [
        "⏱ *Horómetro*",
        "",
        "🚗 *Unidad:* NKL 952",
        "",
        "Pasame el nuevo horómetro en horas y la fecha/hora de la lectura.",
      ].join("\n"),
      createdAt: new Date(Date.now() - 60_000),
      rawPayload: {},
    },
  );
  const pendingAction = structuredClone(basePending);
  pendingAction.createdAt = new Date().toISOString();
  pendingAction.payload.turnLayer = { ...clarifyLayer };
  customerData.pendingAction = pendingAction;
  customerData.activeUnit = {
    plate: "NKL952",
    label: "NKL 952",
    source: "odometro",
    resolvedAt: new Date().toISOString(),
  };
}

resetClarificationState();

let lastTelemetryBody = "";
let telemetryHits = 0;
const originalFetch = globalThis.fetch;
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
  if (/CreateChatBotToken/i.test(url)) {
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
  if (/ConsultarEstadoUnidades/i.test(url)) {
    telemetryHits += 1;
    lastTelemetryBody = bodyText;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        cliente: "El Cacique S.A.",
        unidades: [
          {
            unidad: "M900-121",
            patente: "AG382QB",
            movil_id: 101152,
            ultimo_reporte: { fecha: new Date().toISOString(), hace_segundos: 12 },
            ultima_ignicion: { estado: true, fecha: new Date().toISOString() },
            ultima_posicion: { lat: -34.6, lon: -58.4, fecha: new Date().toISOString() },
          },
        ],
      }),
    };
  }
  if (/ObtenerEstado|ListarUnidades|ObtenerUnidades/i.test(url)) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        cliente: "El Cacique S.A.",
        unidades: [
          {
            unidad: "M900-121",
            patente: "AG382QB",
            movil_id: 101152,
          },
        ],
      }),
    };
  }
  return { ok: true, status: 200, json: async () => ({ ok: true }) };
};

const { runTurnExecutorPhase } = await import("../src/lib/whatsappTurnExecutor.ts");
const { getPendingAction } = await import("../src/lib/pendingAction.ts");
const { getActiveUnit } = await import("../src/lib/activeUnit.ts");
const { prisma: boundPrisma } = await import("../src/lib/db.ts");
assert.equal(boundPrisma, mockPrisma, "db debe usar mock Prisma");

console.log("=== Caso 1: aclaración → GPS → consulta 900121 ===");
resetClarificationState();
assert.equal(readTurnLayer(customerData.pendingAction)?.activeExpectation, "clarification");
assert.equal(readPendingClarification(customerData.pendingAction)?.unitRef.value, "900121");

telemetryHits = 0;
lastTelemetryBody = "";
{
  const res = await runTurnExecutorPhase({
    rawPhone: PHONE,
    selectionText: "GPS",
    apiKey: API_KEY,
  });
  assert.ok(res.message?.trim(), "debe responder overlay");
  assert.ok(telemetryHits >= 1, "debe consultar telemetría");
  assert.match(
    `${lastTelemetryBody} ${res.message}`,
    /900121|M900-121|AG\s*382\s*QB/i,
    "consulta debe apuntar a 900121",
  );

  const pending = await getPendingAction(mockPrisma, PHONE);
  const layer = readTurnLayer(pending);
  assert.notEqual(layer?.activeExpectation, "clarification", "clarificación cerrada");
  assert.equal(readPendingClarification(pending), null);
  assert.equal(
    String(pending?.payload?.plate || pending?.payload?.patente || "")
      .replace(/\s+/g, "")
      .toUpperCase(),
    "NKL952",
  );
  const active = await getActiveUnit(mockPrisma, PHONE);
  assert.equal(String(active?.plate || "").replace(/\s+/g, "").toUpperCase(), "NKL952");
}

console.log("=== Caso 2: aclaración → es el dato del trámite → retoma odómetro ===");
resetClarificationState();
assert.equal(readPendingClarification(customerData.pendingAction)?.unitRef.value, "900121");

{
  const res = await runTurnExecutorPhase({
    rawPhone: PHONE,
    selectionText: "es el dato del trámite",
    apiKey: API_KEY,
  });
  assert.ok(res.message?.trim());
  assert.equal(res.executor, "odometro", "debe retomar odómetro");
  assert.doesNotMatch(res.message, /¿Querés el \*estado\/GPS\*/i);

  const pending = await getPendingAction(mockPrisma, PHONE);
  assert.equal(readPendingClarification(pending), null);
  const layer = readTurnLayer(pending);
  assert.notEqual(layer?.activeExpectation, "clarification");
  assert.equal(layer?.forkPending ?? false, false);
  assert.equal(
    String(pending?.payload?.plate || pending?.payload?.patente || "")
      .replace(/\s+/g, "")
      .toUpperCase(),
    "NKL952",
  );
}

{
  const restored = clearClarificationRestoreExpectation({
    ...basePending,
    payload: { ...basePending.payload, turnLayer: clarifyLayer },
  });
  assert.equal(restored.activeExpectation, "km");
  assert.equal(restored.pendingClarification, null);
}

console.log("=== Caso 3: aclaración → estado → consulta 900121 ===");
resetClarificationState();
telemetryHits = 0;
lastTelemetryBody = "";
{
  const res = await runTurnExecutorPhase({
    rawPhone: PHONE,
    selectionText: "estado",
    apiKey: API_KEY,
  });
  assert.ok(res.message?.trim());
  assert.ok(telemetryHits >= 1, "estado debe consultar telemetría");
  assert.match(
    `${lastTelemetryBody} ${res.message}`,
    /900121|M900-121|AG\s*382\s*QB/i,
  );
  const pending = await getPendingAction(mockPrisma, PHONE);
  assert.equal(readPendingClarification(pending), null);
}

console.log("=== Caso 4: respuesta ambigua → repregunta conservando 900121 ===");
resetClarificationState();
{
  const res = await runTurnExecutorPhase({
    rawPhone: PHONE,
    selectionText: "tal vez",
    apiKey: API_KEY,
  });
  assert.match(res.message, /900121/);
  assert.match(res.message, /estado|GPS|trámite/i);
  const pending = await getPendingAction(mockPrisma, PHONE);
  assert.equal(readPendingClarification(pending)?.unitRef.value, "900121");
  assert.equal(readTurnLayer(pending)?.activeExpectation, "clarification");
}

console.log("=== Caso 5: sin pending clarif + Estado 900121 → overlay normal ===");
{
  messages.length = 0;
  messages.push({
    id: "m1",
    ticketId: ticket.id,
    direction: "OUTBOUND",
    from: "BOT",
    text: "⏱ *Horómetro*\n\nPasame el nuevo horómetro en horas.",
    createdAt: new Date(Date.now() - 60_000),
    rawPayload: {},
  });
  const pendingAction = structuredClone(basePending);
  pendingAction.createdAt = new Date().toISOString();
  pendingAction.payload.turnLayer = { activeExpectation: "km" };
  customerData.pendingAction = pendingAction;
  customerData.activeUnit = {
    plate: "NKL952",
    label: "NKL 952",
    source: "odometro",
    resolvedAt: new Date().toISOString(),
  };

  telemetryHits = 0;
  lastTelemetryBody = "";
  const res = await runTurnExecutorPhase({
    rawPhone: PHONE,
    selectionText: "Estado 900121",
    apiKey: API_KEY,
  });
  assert.ok(res.message?.trim());
  assert.ok(telemetryHits >= 1, "overlay normal debe consultar");
  assert.match(
    `${lastTelemetryBody} ${res.message}`,
    /900121|M900-121|AG\s*382\s*QB/i,
  );
  const pending = await getPendingAction(mockPrisma, PHONE);
  assert.equal(readPendingClarification(pending), null);
  assert.equal(readTurnLayer(pending)?.activeExpectation, "km");
}

console.log("=== Caso 6: misma política en certificado (clarif + GPS) ===");
{
  messages.length = 0;
  messages.push({
    id: "m1",
    ticketId: ticket.id,
    direction: "OUTBOUND",
    from: "BOT",
    text: "📋 *Confirmar certificado*\n¿Cuál unidad?",
    createdAt: new Date(Date.now() - 60_000),
    rawPayload: {},
  });
  const certPending = {
    type: "certificados",
    createdAt: new Date().toISOString(),
    payload: {
      stage: "awaiting_unit",
      turnLayer: buildUnitRefClarificationTurnLayer(
        "¿Cuál unidad?",
        {
          type: "certificados",
          createdAt: new Date().toISOString(),
          payload: { stage: "awaiting_unit", turnLayer: { activeExpectation: "unit" } },
        },
        { kind: "unit_name", value: "900121" },
      ),
    },
  };
  customerData.pendingAction = certPending;
  customerData.activeUnit = null;

  telemetryHits = 0;
  lastTelemetryBody = "";
  const res = await runTurnExecutorPhase({
    rawPhone: PHONE,
    selectionText: "GPS",
    apiKey: API_KEY,
  });
  assert.ok(res.message?.trim());
  assert.ok(telemetryHits >= 1);
  assert.match(
    `${lastTelemetryBody} ${res.message}`,
    /900121|M900-121|AG\s*382\s*QB/i,
  );
  const pending = await getPendingAction(mockPrisma, PHONE);
  assert.equal(readPendingClarification(pending), null);
}

globalThis.fetch = originalFetch;
console.log("OK verify-unit-ref-clarification-continuity");
