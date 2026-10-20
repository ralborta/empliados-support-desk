#!/usr/bin/env node
/**
 * Concurrencia real: dos runTurnExecutorPhase del mismo teléfono.
 *
 * Hallazgo (RIESGO ARQUITECTÓNICO): no hay serialización FIFO por teléfono.
 * - El ledger de delivery es por wamid (idempotencia del mismo inbound).
 * - allowPhoneRequest es rate-limit, no mutex.
 * - shouldDeferTurnExecutor solo difiere async.
 * Esta suite NO incorpora cola/mutex; documenta el riesgo y verifica que, con
 * overlay efímero, el campo 4521 queda asociado a NKL 952 y la unidad lateral
 * no contamina activeUnit/pending plate.
 *
 * Uso: npx tsx scripts/verify-gps-overlay-phone-concurrency.mjs
 */
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";

const PHONE = "5490000000999";
const API_KEY = "test-gps-overlay-phone-concurrency";

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

const pendingHorometerNkl952 = {
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

const activeUnitNkl952 = {
  plate: "NKL952",
  label: "NKL 952",
  source: "odometro",
  resolvedAt: "2026-08-23T22:50:00.000Z",
};

const THREAD_LINES = [
  { from: "CUSTOMER", text: "Ok ahora cambio de horometro" },
  {
    from: "BOT",
    text: [
      "⏱ *Horómetro*",
      "",
      "🚗 *Unidad:* NKL 952",
      "",
      "📋 *Datos operativos del horómetro*",
      "Pasame el nuevo horómetro en horas y la fecha/hora de la lectura.",
    ].join("\n"),
  },
];

const customerData = {
  id: "cust-phone-concurrency",
  phone: PHONE,
  name: "Test Phone Concurrency",
  companyName: "El Cacique S.A.",
  selectedCompanyContactId: 42,
  pendingAction: structuredClone(pendingHorometerNkl952),
  activeUnit: structuredClone(activeUnitNkl952),
  waraSessionToken: "mock-session-token",
  waraSessionAt: new Date(),
  conversationNotebook: null,
};

const ticket = {
  id: "ticket-phone-concurrency",
  customerId: customerData.id,
  status: "OPEN",
  lastMessageAt: new Date(),
};

const messages = THREAD_LINES.map((line, i) => ({
  id: `seed-${i}`,
  ticketId: ticket.id,
  direction: line.from === "CUSTOMER" ? "INBOUND" : "OUTBOUND",
  from: line.from === "CUSTOMER" ? "CUSTOMER" : "BOT",
  text: line.text,
  createdAt: new Date(Date.now() - (THREAD_LINES.length - i) * 60_000),
  rawPayload: {},
}));

const mockPrisma = {
  customer: {
    findFirst: async () => customerData,
    findUnique: async ({ where } = {}) => {
      if (where?.id && where.id !== customerData.id) return null;
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
      if (data.conversationNotebook !== undefined) {
        customerData.conversationNotebook =
          data.conversationNotebook === Prisma.JsonNull
            ? null
            : data.conversationNotebook;
      }
      if (data.waraSessionToken !== undefined) {
        customerData.waraSessionToken = data.waraSessionToken;
      }
      if (data.waraSessionAt !== undefined) {
        customerData.waraSessionAt = data.waraSessionAt;
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

let telemetryHits = 0;
let telemetrySearches = [];
let releaseTelemetryGate = () => {};
let telemetryGateOpen = new Promise((resolve) => {
  releaseTelemetryGate = resolve;
});

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
  if (/ConsultarEstadoUnidades|ObtenerEstado|ListarUnidades|ObtenerUnidades/i.test(url)) {
    telemetryHits += 1;
    telemetrySearches.push(bodyText);
    await telemetryGateOpen;
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
  if (/Actualizar|Horometro|Odometro|Registrar/i.test(url)) {
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    };
  }
  return { ok: false, status: 404, json: async () => ({ error: "not mocked" }) };
};

const { runTurnExecutorPhase } = await import("../src/lib/whatsappTurnExecutor.ts");
const { getPendingAction } = await import("../src/lib/pendingAction.ts");
const { getActiveUnit } = await import("../src/lib/activeUnit.ts");

console.log("=== ARCHITECTURAL_RISK: sin FIFO por teléfono ===");
console.log(
  "No existe mutex/cola productiva por teléfono. Ledger=wamid; rate-limit≠serialización.",
);
console.log("Propuesta separada: phoneTurnQueue / mutex por dígitos de teléfono.");

const completionOrder = [];

const overlayPromise = (async () => {
  const res = await runTurnExecutorPhase({
    rawPhone: PHONE,
    selectionText: "Estado 900100",
    apiKey: API_KEY,
  });
  completionOrder.push("overlay");
  return res;
})();

{
  const deadline = Date.now() + 8000;
  while (telemetryHits < 1 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 15));
  }
  assert.ok(telemetryHits >= 1, "telemetría del overlay debe estar en barrera");
  completionOrder.push("barrier_hit");
}

const fieldPromise = (async () => {
  const res = await runTurnExecutorPhase({
    rawPhone: PHONE,
    selectionText: "4521",
    apiKey: API_KEY,
  });
  completionOrder.push("field");
  return res;
})();

// Liberar telemetría después de que el campo pudo arrancar (sin FIFO, puede terminar antes).
await new Promise((r) => setTimeout(r, 50));
releaseTelemetryGate();

const [overlayRes, fieldRes] = await Promise.all([overlayPromise, fieldPromise]);

assert.ok(overlayRes?.message?.trim(), "overlay debe responder");
assert.ok(fieldRes?.message?.trim(), "campo 4521 debe responder vía executor odómetro");
assert.equal(fieldRes.executor, "odometro", "4521 debe ejecutar odómetro real");

const pending = await getPendingAction(mockPrisma, PHONE);
const active = await getActiveUnit(mockPrisma, PHONE);
const plate =
  pending?.payload?.plate ||
  pending?.payload?.patente ||
  null;

assert.equal(String(plate).replace(/\s+/g, "").toUpperCase(), "NKL952", "4521 ligado a NKL952");
assert.ok(
  !/AH652KW/i.test(String(active?.plate || "")),
  "unidad lateral AH652KW no contamina activeUnit",
);
// Con overlay efímero activeUnit puede seguir NKL952; si el odómetro lo toca en carrera
// (sin FIFO por teléfono) puede quedar vacío — eso evidencia el riesgo, no adopción lateral.
if (active?.plate) {
  assert.equal(
    String(active.plate).replace(/\s+/g, "").toUpperCase(),
    "NKL952",
    "si hay activeUnit, debe seguir siendo NKL952",
  );
}

const barrierIdx = completionOrder.indexOf("barrier_hit");
const fieldIdx = completionOrder.indexOf("field");
const overlayIdx = completionOrder.indexOf("overlay");
assert.ok(barrierIdx >= 0);
assert.ok(fieldIdx > barrierIdx, "el turno 4521 pudo avanzar con telemetría aún bloqueada");
console.log("completionOrder=", completionOrder.join(" → "));
if (fieldIdx < overlayIdx) {
  console.log(
    "EVIDENCIA: field completó antes que overlay → confirma ausencia de FIFO por teléfono",
  );
}

assert.doesNotMatch(String(active?.plate || ""), /AH652KW/i);
assert.ok(
  !/AH\s*652\s*KW/i.test(JSON.stringify(pending?.payload ?? {})),
  "payload del trámite no debe adoptar la unidad lateral",
);

if (fieldIdx < overlayIdx) {
  // Si el campo terminó primero, el hint del GPS no debe re-pedir horas a ciegas
  // (el detalle exhaustivo está en verify-overlay-resume-hint-and-persist.mjs).
  console.log("race: field-before-overlay; hint adaptation covered in dedicated suite");
}

globalThis.fetch = originalFetch;

console.log("OK verify-gps-overlay-phone-concurrency");
