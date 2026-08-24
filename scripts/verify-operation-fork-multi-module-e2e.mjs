#!/usr/bin/env node
/**
 * Sagas E2E: fork multi-módulo sin contaminar type/payload + aclaración con executor dueño.
 *
 * 1. Cert unit + mantenimiento → fork; pending sigue certificados
 * 2. Maint detail + certificado → fork; pending sigue mantenimiento
 * 3. Horo + certificado → fork; pending odometro meterType=horometro
 * 4. Cert + unitRef ambiguo → aclaración executor certificados
 * 5. Maint + unitRef ambiguo → aclaración executor mantenimiento
 * 6. Fallo persistir fork → sin menú falso; pending intacto
 * 7. “Seguir” → restaura expectativa exacta del módulo original
 *
 * Uso: npx tsx scripts/verify-operation-fork-multi-module-e2e.mjs
 */
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";

const PHONE = "5490000000888";
const API_KEY = "test-fork-multi-module";

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

const customerData = {
  id: "cust-fork-multi",
  phone: PHONE,
  name: "Test Fork Multi",
  companyName: "El Cacique S.A.",
  selectedCompanyContactId: 42,
  pendingAction: null,
  activeUnit: null,
  waraSessionToken: "mock-session-token",
  waraSessionAt: new Date(),
  conversationNotebook: null,
};

const ticket = {
  id: "ticket-fork-multi",
  customerId: customerData.id,
  status: "OPEN",
  lastMessageAt: new Date(),
};

const messages = [];
let failPendingWrites = false;

const mockPrisma = {
  customer: {
    findFirst: async () => customerData,
    findUnique: async ({ where } = {}) => {
      if (where?.phone && String(where.phone) !== PHONE) return null;
      return customerData;
    },
    update: async ({ data }) => {
      if (failPendingWrites && data.pendingAction !== undefined) {
        throw new Error("simulated pendingAction persist failure");
      }
      if (data.pendingAction !== undefined) {
        customerData.pendingAction =
          data.pendingAction === Prisma.JsonNull
            ? null
            : structuredClone(data.pendingAction);
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

globalThis.prisma = mockPrisma;

const originalFetch = globalThis.fetch;
globalThis.fetch = async (input) => {
  const url = String(input);
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
  return { ok: true, status: 200, json: async () => ({ ok: true }) };
};

const { runTurnExecutorPhase } = await import("../src/lib/whatsappTurnExecutor.ts");
const { getPendingAction } = await import("../src/lib/pendingAction.ts");
const { readTurnLayer, isTurnLayerForkPending, readPendingClarification } = await import(
  "../src/lib/turnLayerContract.ts"
);
const { prisma: boundPrisma } = await import("../src/lib/db.ts");
assert.equal(boundPrisma, mockPrisma, "db debe usar mock Prisma");

function seedMessages(botText) {
  messages.length = 0;
  messages.push({
    id: "m-bot",
    ticketId: ticket.id,
    direction: "OUTBOUND",
    from: "BOT",
    text: botText,
    createdAt: new Date(Date.now() - 30_000),
    rawPayload: {},
  });
}

function pendingCertUnit() {
  return {
    type: "certificados",
    createdAt: new Date().toISOString(),
    summary: "Certificado — esperando unidad",
    payload: {
      stage: "awaiting_unit",
      turnLayer: { activeExpectation: "unit", forkPending: false },
    },
  };
}

function pendingMaintDetail() {
  return {
    type: "mantenimiento",
    createdAt: new Date().toISOString(),
    summary: "Mantenimiento AG228NZ",
    payload: {
      stage: "collecting",
      patente: "AG228NZ",
      plate: "AG228NZ",
      turnLayer: { activeExpectation: "detail", forkPending: false },
    },
  };
}

function pendingHoro() {
  return {
    type: "odometro",
    createdAt: new Date().toISOString(),
    summary: "Horómetro AG228NZ",
    payload: {
      stage: "collecting",
      meterType: "horometro",
      patente: "AG228NZ",
      plate: "AG228NZ",
      turnLayer: { activeExpectation: "km", forkPending: false },
    },
  };
}

function pendingCertConfirmo() {
  return {
    type: "certificados",
    createdAt: new Date().toISOString(),
    summary: "Confirmar certificado AG228NZ",
    payload: {
      stage: "confirmation_required",
      plate: "AG228NZ",
      turnLayer: { activeExpectation: "confirmo", forkPending: false },
    },
  };
}

console.log("=== 1. Cert unit + mantenimiento → fork; type certificados ===");
{
  seedMessages("📋 *Certificado*\n¿Cuál unidad? Pasame la matrícula.");
  customerData.pendingAction = pendingCertUnit();
  customerData.activeUnit = null;
  const res = await runTurnExecutorPhase({
    rawPhone: PHONE,
    selectionText: "quiero hacer un mantenimiento preventivo",
    apiKey: API_KEY,
  });
  assert.match(res.message, /Cambiar de requerimiento|Seguir con el trámite/i);
  assert.equal(res.executor, "certificados");
  const pending = await getPendingAction(mockPrisma, PHONE);
  assert.equal(pending?.type, "certificados");
  assert.equal(isTurnLayerForkPending(pending), true);
  assert.equal(readTurnLayer(pending)?.pausedExpectation, "unit");
  assert.equal(readTurnLayer(pending)?.activeExpectation, "fork_choice");
}

console.log("=== 2. Maint detail + certificado → fork; type mantenimiento ===");
{
  seedMessages("🛠 *Mantenimiento*\nContame qué hay que hacer.");
  customerData.pendingAction = pendingMaintDetail();
  const res = await runTurnExecutorPhase({
    rawPhone: PHONE,
    selectionText: "necesito un certificado de cobertura",
    apiKey: API_KEY,
  });
  assert.match(res.message, /Cambiar de requerimiento|Seguir con el trámite/i);
  assert.equal(res.executor, "mantenimiento");
  const pending = await getPendingAction(mockPrisma, PHONE);
  assert.equal(pending?.type, "mantenimiento");
  assert.equal(pending?.payload?.patente, "AG228NZ");
  assert.equal(isTurnLayerForkPending(pending), true);
  assert.equal(readTurnLayer(pending)?.pausedExpectation, "detail");
}

console.log("=== 3. Horo + certificado → fork; odometro meterType=horometro ===");
{
  seedMessages("⏱ *Horómetro*\nPasame el valor en hs.");
  customerData.pendingAction = pendingHoro();
  const res = await runTurnExecutorPhase({
    rawPhone: PHONE,
    selectionText: "necesito un certificado de cobertura",
    apiKey: API_KEY,
  });
  assert.match(res.message, /Cambiar de requerimiento|Seguir con el trámite/i);
  assert.equal(res.executor, "odometro");
  const pending = await getPendingAction(mockPrisma, PHONE);
  assert.equal(pending?.type, "odometro");
  assert.equal(pending?.payload?.meterType, "horometro");
  assert.equal(pending?.payload?.patente, "AG228NZ");
  assert.equal(isTurnLayerForkPending(pending), true);
  assert.equal(readTurnLayer(pending)?.pausedExpectation, "km");
}

console.log("=== 4. Cert + unitRef ambiguo → aclaración executor certificados ===");
{
  seedMessages("📋 *Confirmar certificado*\nRespondé CONFIRMO o CANCELAR");
  customerData.pendingAction = pendingCertConfirmo();
  const res = await runTurnExecutorPhase({
    rawPhone: PHONE,
    selectionText: "M900-121",
    apiKey: API_KEY,
  });
  assert.equal(res.executor, "certificados");
  assert.match(res.message, /M900-121|900121|estado|GPS|trámite/i);
  const pending = await getPendingAction(mockPrisma, PHONE);
  assert.equal(pending?.type, "certificados");
  assert.equal(readTurnLayer(pending)?.activeExpectation, "clarification");
  assert.equal(readPendingClarification(pending)?.unitRef.value, "M900-121");
  assert.equal(readTurnLayer(pending)?.pausedExpectation, "confirmo");
}

console.log("=== 5. Maint + unitRef ambiguo → aclaración executor mantenimiento ===");
{
  seedMessages("🛠 *Mantenimiento*\nContame el detalle del servicio.");
  customerData.pendingAction = pendingMaintDetail();
  const res = await runTurnExecutorPhase({
    rawPhone: PHONE,
    selectionText: "M900-121",
    apiKey: API_KEY,
  });
  assert.equal(res.executor, "mantenimiento");
  assert.match(res.message, /M900-121|900121|estado|GPS|trámite/i);
  const pending = await getPendingAction(mockPrisma, PHONE);
  assert.equal(pending?.type, "mantenimiento");
  assert.equal(readTurnLayer(pending)?.activeExpectation, "clarification");
  assert.equal(readPendingClarification(pending)?.unitRef.value, "M900-121");
  assert.equal(readTurnLayer(pending)?.pausedExpectation, "detail");
}

console.log("=== 6. Fallo persistir fork → sin menú falso; pending intacto ===");
{
  seedMessages("📋 *Certificado*\n¿Cuál unidad?");
  const original = pendingCertUnit();
  customerData.pendingAction = structuredClone(original);
  failPendingWrites = true;
  const res = await runTurnExecutorPhase({
    rawPhone: PHONE,
    selectionText: "quiero hacer un mantenimiento preventivo",
    apiKey: API_KEY,
  });
  failPendingWrites = false;
  assert.match(res.message, /no pude guardar/i);
  assert.doesNotMatch(res.message, /¿Qué preferís\?/i);
  assert.doesNotMatch(res.message, /• \*Cambiar de requerimiento\*/i);
  assert.equal(res.executor, "certificados");
  const pending = await getPendingAction(mockPrisma, PHONE);
  assert.equal(pending?.type, "certificados");
  assert.equal(readTurnLayer(pending)?.activeExpectation, "unit");
  assert.equal(isTurnLayerForkPending(pending), false);
}

console.log("=== 7. Seguir → restaura expectativa exacta del módulo original ===");
{
  seedMessages(
    [
      "Estás con un trámite de *mantenimiento* en curso.",
      "¿Qué preferís?",
      "• *Cambiar de requerimiento*",
      "• *Seguir con el trámite*",
    ].join("\n"),
  );
  customerData.pendingAction = {
    type: "mantenimiento",
    createdAt: new Date().toISOString(),
    summary: "Mantenimiento AG228NZ",
    payload: {
      stage: "collecting",
      patente: "AG228NZ",
      plate: "AG228NZ",
      turnLayer: {
        activeExpectation: "fork_choice",
        pausedExpectation: "detail",
        forkPending: true,
        lateralPause: true,
      },
    },
  };
  const res = await runTurnExecutorPhase({
    rawPhone: PHONE,
    selectionText: "Seguir con el trámite",
    apiKey: API_KEY,
  });
  assert.equal(res.executor, "mantenimiento");
  const pending = await getPendingAction(mockPrisma, PHONE);
  assert.equal(pending?.type, "mantenimiento");
  assert.equal(readTurnLayer(pending)?.activeExpectation, "detail");
  assert.equal(readTurnLayer(pending)?.forkPending, false);
  assert.equal(pending?.payload?.patente, "AG228NZ");
}

globalThis.fetch = originalFetch;
console.log("OK verify-operation-fork-multi-module-e2e");
