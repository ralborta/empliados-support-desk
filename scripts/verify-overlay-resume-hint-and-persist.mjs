#!/usr/bin/env node
/**
 * Overlay resume hint (relectura) + fallo de persistencia pendingClarification.
 *
 * Uso: npx tsx scripts/verify-overlay-resume-hint-and-persist.mjs
 */
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";

const PHONE = "5490000000666";
const API_KEY = "test-overlay-resume-persist";

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

const basePending = () => ({
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
});

const customerData = {
  id: "cust-overlay-resume",
  phone: PHONE,
  name: "Test Resume",
  companyName: "El Cacique S.A.",
  selectedCompanyContactId: 42,
  pendingAction: basePending(),
  activeUnit: {
    plate: "NKL952",
    label: "NKL 952",
    source: "odometro",
    resolvedAt: new Date().toISOString(),
  },
  waraSessionToken: "mock-session-token",
  waraSessionAt: new Date(),
  conversationNotebook: null,
};

const ticket = {
  id: "ticket-overlay-resume",
  customerId: customerData.id,
  status: "OPEN",
  lastMessageAt: new Date(),
};

const messages = [];
let failPendingWrites = false;

function seedThread() {
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
}

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

globalThis.prisma = mockPrisma;
seedThread();

const {
  buildOverlayResumeHintFromCurrentPending,
  buildUnitRefClarificationPersistFailureReply,
  buildDeclarativePendingWriteResumeHint,
  composeOverlayReadKeepPendingReply,
} = await import("../src/lib/pendingWriteInterference.ts");

const {
  buildUnitRefClarificationTurnLayer,
  readPendingClarification,
  readTurnLayer,
} = await import("../src/lib/turnLayerContract.ts");

const { patchPendingActionPayload } = await import("../src/lib/pendingAction.ts");
const { buildUnitReferenceClarifyReply } = await import(
  "../src/lib/utteranceUnderstanding.ts"
);

console.log("=== Unit: resume hint desde estado actual ===");
{
  const hoursHint = buildOverlayResumeHintFromCurrentPending({
    pendingAction: basePending(),
    pendingKind: "odometro",
  });
  assert.match(hoursHint ?? "", /horas/i);

  const advanced = basePending();
  advanced.payload.horometro = 4521;
  advanced.payload.turnLayer.activeExpectation = "fecha_hora";
  const fechaHint = buildOverlayResumeHintFromCurrentPending({
    pendingAction: advanced,
    pendingKind: "odometro",
  });
  assert.ok(fechaHint);
  assert.doesNotMatch(fechaHint, /enviando las horas/i);
  assert.match(fechaHint, /fecha/i);

  const valueOnly = basePending();
  valueOnly.payload.horometro = 4521;
  // expectation still km — debe adaptar
  const adapted = buildOverlayResumeHintFromCurrentPending({
    pendingAction: valueOnly,
    pendingKind: "odometro",
  });
  assert.doesNotMatch(adapted ?? "", /enviando las horas/i);

  assert.equal(
    buildOverlayResumeHintFromCurrentPending({ pendingAction: null, pendingKind: null }),
    null,
  );

  const cancelled = basePending();
  cancelled.payload.stage = "cancelled";
  assert.equal(
    buildOverlayResumeHintFromCurrentPending({
      pendingAction: cancelled,
      pendingKind: "odometro",
    }),
    null,
  );

  const completed = basePending();
  completed.payload.stage = "completed";
  assert.equal(
    buildOverlayResumeHintFromCurrentPending({
      pendingAction: completed,
      pendingKind: "odometro",
    }),
    null,
  );
}

console.log("=== Unit: fallo persistencia → sin pregunta de continuidad ===");
{
  const safe = buildUnitRefClarificationPersistFailureReply("900121");
  assert.doesNotMatch(safe, /¿Querés el \*estado\/GPS\*/i);
  assert.match(safe, /trámite en curso sigue/i);

  const clarifyQ = buildUnitReferenceClarifyReply({
    referent: "vehicle_unit",
    confidence: 0.95,
    clarifyQuestion: null,
    action: "unit_reference",
    unitRef: { kind: "unit_name", value: "900121" },
  });
  assert.match(clarifyQ, /estado|GPS/i);

  customerData.pendingAction = basePending();
  failPendingWrites = true;
  const ok = await patchPendingActionPayload(mockPrisma, PHONE, {
    turnLayer: buildUnitRefClarificationTurnLayer("thread", customerData.pendingAction, {
      kind: "unit_name",
      value: "900121",
    }),
  });
  assert.equal(ok, false, "patch debe reportar fallo");
  assert.equal(
    readPendingClarification(customerData.pendingAction),
    null,
    "no se persistió pendingClarification",
  );
  failPendingWrites = false;
}

let releaseTelemetryGate = () => {};
let telemetryGateOpen = new Promise((resolve) => {
  releaseTelemetryGate = resolve;
});
let telemetryHits = 0;

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
    // Solo la primera telemetría (overlay GPS) queda en barrera; el odómetro
    // no debe quedar muerto detrás del mismo gate.
    if (telemetryHits === 1) await telemetryGateOpen;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        cliente: "El Cacique S.A.",
        unidades: [
          {
            unidad: "M900-100",
            patente: "AH652KW",
            movil_id: 151018,
            ultimo_reporte: { fecha: new Date().toISOString(), hace_segundos: 30 },
            ultima_ignicion: { estado: false, fecha: new Date().toISOString() },
            ultima_posicion: { lat: -34.6, lon: -58.4, fecha: new Date().toISOString() },
          },
        ],
      }),
    };
  }
  return { ok: true, status: 200, json: async () => ({ ok: true }) };
};

const { runTurnExecutorPhase } = await import("../src/lib/whatsappTurnExecutor.ts");
const { getPendingAction } = await import("../src/lib/pendingAction.ts");
const { prisma: boundPrisma } = await import("../src/lib/db.ts");
assert.equal(boundPrisma, mockPrisma);

console.log("=== Integración: 4521 termina primero → GPS no pide horas otra vez ===");
{
  seedThread();
  customerData.pendingAction = basePending();
  telemetryHits = 0;
  releaseTelemetryGate = () => {};
  telemetryGateOpen = new Promise((resolve) => {
    releaseTelemetryGate = resolve;
  });

  const overlayPromise = runTurnExecutorPhase({
    rawPhone: PHONE,
    selectionText: "Estado 900100",
    apiKey: API_KEY,
  });

  const deadline = Date.now() + 8000;
  while (telemetryHits < 1 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 15));
  }
  assert.ok(telemetryHits >= 1, "telemetría en barrera");

  await runTurnExecutorPhase({
    rawPhone: PHONE,
    selectionText: "4521",
    apiKey: API_KEY,
  });
  // Estado post-campo: horas cargadas / expectativa avanzada.
  if (customerData.pendingAction?.payload) {
    customerData.pendingAction.payload.horometro = 4521;
    customerData.pendingAction.payload.turnLayer = {
      ...(customerData.pendingAction.payload.turnLayer ?? {}),
      activeExpectation: "fecha_hora",
    };
  }

  releaseTelemetryGate();
  const overlayRes = await overlayPromise;
  assert.ok(overlayRes.message?.trim());
  assert.doesNotMatch(
    overlayRes.message,
    /enviando las horas/i,
    "GPS posterior no debe re-pedir las horas",
  );
  const hint = buildOverlayResumeHintFromCurrentPending({
    pendingAction: await getPendingAction(mockPrisma, PHONE),
    pendingKind: "odometro",
  });
  if (hint) assert.doesNotMatch(hint, /enviando las horas/i);
}

console.log("=== Integración: trámite cancelado durante telemetría → GPS sin hint ===");
{
  seedThread();
  customerData.pendingAction = basePending();
  telemetryHits = 0;
  releaseTelemetryGate = () => {};
  telemetryGateOpen = new Promise((resolve) => {
    releaseTelemetryGate = resolve;
  });

  const overlayPromise = runTurnExecutorPhase({
    rawPhone: PHONE,
    selectionText: "Estado 900100",
    apiKey: API_KEY,
  });

  const deadline = Date.now() + 8000;
  while (telemetryHits < 1 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 15));
  }
  assert.ok(telemetryHits >= 1);

  customerData.pendingAction = null;

  releaseTelemetryGate();
  const overlayRes = await overlayPromise;
  assert.ok(overlayRes.message?.trim());
  assert.doesNotMatch(overlayRes.message, /sigue pendiente/i);
  assert.doesNotMatch(overlayRes.message, /enviando las horas/i);
  assert.doesNotMatch(overlayRes.message, /horómetro/i);
}

console.log("=== Integración: clear clarification falla → sin falsa continuidad ===");
{
  seedThread();
  const pending = basePending();
  pending.payload.turnLayer = buildUnitRefClarificationTurnLayer(
    "Pasame horas",
    pending,
    { kind: "unit_name", value: "900121" },
  );
  customerData.pendingAction = pending;
  assert.ok(readPendingClarification(customerData.pendingAction));

  failPendingWrites = true;
  const res = await runTurnExecutorPhase({
    rawPhone: PHONE,
    selectionText: "GPS",
    apiKey: API_KEY,
  });
  failPendingWrites = false;

  assert.match(res.message, /no pude guardar el contexto/i);
  assert.doesNotMatch(res.message, /¿Querés el \*estado\/GPS\*/i);
  assert.equal(
    readTurnLayer(customerData.pendingAction)?.activeExpectation,
    "clarification",
    "trámite/aclaración original conservados",
  );
  assert.equal(readPendingClarification(customerData.pendingAction)?.unitRef.value, "900121");
}

// sanity compose
assert.equal(
  composeOverlayReadKeepPendingReply("GPS ok", null),
  "GPS ok",
);
assert.match(
  buildDeclarativePendingWriteResumeHint({
    writeKind: "odometro",
    meterKind: "horometro",
    plateDisplay: "NKL952",
    activeExpectation: "km",
  }) ?? "",
  /horas/i,
);

globalThis.fetch = originalFetch;
console.log("OK verify-overlay-resume-hint-and-persist");
