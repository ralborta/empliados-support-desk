#!/usr/bin/env node
/**
 * E2E handler: pending action_choice + historial de certificado.
 * - «Sí, en 900173» → collecting con patente de flota, pide km (no Confirmar certificado)
 * - Interno explícito inexistente → no reutiliza activeUnit anterior
 *
 * Uso: npx tsx scripts/verify-odometer-live-pending-over-cert-history-e2e.mjs
 */
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { NextRequest } from "next/server";

const PHONE = "5491133788199";
const API_KEY = "test-odometer-live-pending-e2e";

process.env.BUILDERBOT_CONTEXT_API_KEY = API_KEY;
process.env.WARA_DIALOGUE_AI_ODOMETRO = "false";
process.env.WARA_UTTERANCE_UNDERSTANDING = "false";
process.env.WARA_AGENT_MODE = "false";
process.env.WARA_OBTENER_EMPRESA_TOKEN =
  process.env.WARA_OBTENER_EMPRESA_TOKEN || "test-empresa-token";
process.env.WARA_API_BASE_URL = "https://wara.test.local";
process.env.NODE_ENV = "test";

const CERT_THREAD_LINES = [
  "Cliente: Quiero un certificado",
  "Atilio: Para generar el certificado, necesito que me confirmes la patente de la unidad. ¿Cuál es?",
  "Cliente: Odometro",
  "Atilio: ¿Qué necesitás con el odómetro: corregir o actualizar el kilometraje, o es otra consulta?",
];

const FLEET_UNITS = [
  {
    unidad: "M900-173",
    patente: "AD578XY",
    movil_id: 900173,
    ultimo_reporte: { fecha: new Date().toISOString(), hace_segundos: 30 },
  },
];

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
        contactos: [{ id: 131776, empresa: "El Cacique S.A.", nombre: "Test" }],
        SessionToken: "mock-session-token",
      }),
    };
  }
  if (/ObtenerEmpresaPorNumero|CreateChatBotToken/i.test(url)) {
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
  if (/ConsultarEstadoUnidades|ListarUnidades|ValidarPatente|flota/i.test(url)) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        cliente: "El Cacique S.A.",
        unidades: FLEET_UNITS,
      }),
    };
  }
  return { ok: false, status: 404, json: async () => ({ error: "not mocked" }) };
};

function seedThreadMessages() {
  return CERT_THREAD_LINES.map((line, i) => {
    const isClient = line.startsWith("Cliente:");
    return {
      id: `m${i}`,
      ticketId: "ticket-live-pending",
      direction: isClient ? "INBOUND" : "OUTBOUND",
      from: isClient ? "CUSTOMER" : "BOT",
      text: line.replace(/^Cliente: |^Atilio: /, ""),
      createdAt: new Date(Date.now() - (CERT_THREAD_LINES.length - i) * 120000),
    };
  });
}

function createMockState() {
  const threadMessages = seedThreadMessages();
  const customerData = {
    id: "cust-live-pending",
    phone: PHONE,
    name: "Test Live Pending E2E",
    pendingAction: {
      type: "odometro",
      payload: {
        stage: "odometer_action_choice",
        clarifyStage: "clarify_odometer_intent",
        turnLayer: { activeExpectation: "clarification" },
      },
      createdAt: new Date().toISOString(),
    },
    activeUnit: {
      plate: "AG382QD",
      label: "AG 382 QD",
      source: "certificado",
      resolvedAt: new Date().toISOString(),
    },
  };
  const ticket = {
    id: "ticket-live-pending",
    customerId: customerData.id,
    status: "OPEN",
    lastMessageAt: new Date(),
  };

  function applyCustomerUpdate(data) {
    if (data.pendingAction !== undefined) {
      customerData.pendingAction =
        data.pendingAction === Prisma.JsonNull ? null : data.pendingAction;
    }
    if (data.activeUnit !== undefined) {
      customerData.activeUnit =
        data.activeUnit === Prisma.JsonNull ? null : data.activeUnit;
    }
  }

  function reset() {
    threadMessages.length = 0;
    threadMessages.push(...seedThreadMessages());
    customerData.pendingAction = {
      type: "odometro",
      payload: {
        stage: "odometer_action_choice",
        clarifyStage: "clarify_odometer_intent",
        turnLayer: { activeExpectation: "clarification" },
      },
      createdAt: new Date().toISOString(),
    };
    customerData.activeUnit = {
      plate: "AG382QD",
      label: "AG 382 QD",
      source: "certificado",
      resolvedAt: new Date().toISOString(),
    };
  }

  const mockPrisma = {
    customer: {
      findUnique: async ({ where, select }) => {
        if (where.phone !== PHONE && where.id !== customerData.id) return null;
        if (select) {
          const out = {};
          for (const [k, v] of Object.entries(select)) {
            if (v) out[k] = customerData[k];
          }
          return out;
        }
        return { ...customerData };
      },
      findFirst: async () => ({ ...customerData }),
      update: async ({ where, data }) => {
        if (where.phone !== PHONE && where.id !== customerData.id) {
          throw new Error("customer not found for update");
        }
        applyCustomerUpdate(data);
        return { ...customerData };
      },
    },
    ticket: {
      findFirst: async () => ticket,
      update: async () => ticket,
    },
    ticketMessage: {
      findMany: async ({ where, take }) => {
        let rows = [...threadMessages];
        if (where?.ticketId) rows = rows.filter((m) => m.ticketId === where.ticketId);
        rows.sort((a, b) => b.createdAt - a.createdAt);
        if (take) rows = rows.slice(0, take);
        return rows.map((m) => ({ text: m.text }));
      },
      findFirst: async () => null,
      create: async ({ data }) => {
        threadMessages.push({
          id: `m${threadMessages.length}`,
          ticketId: data.ticketId,
          direction: data.direction,
          from: data.from,
          text: data.text,
          createdAt: new Date(),
        });
        return { id: `m${threadMessages.length}` };
      },
    },
    $queryRaw: async () => [],
    reset,
    getCustomer: () => customerData,
  };

  return mockPrisma;
}

const mockPrisma = createMockState();
globalThis.prisma = mockPrisma;

const { POST } = await import("../src/app/api/wara/odometro-horometro/route.ts");
const { ODOMETER_ACTION_CHOICE_STAGE } = await import("../src/lib/odometerActionChoice.ts");

async function postOdometer(body) {
  const req = new NextRequest("http://internal/api/wara/odometro-horometro", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": API_KEY,
    },
    body: JSON.stringify({
      from: PHONE,
      phone: PHONE,
      body,
      rawText: body,
    }),
  });
  const res = await POST(req);
  return await res.json();
}

try {
  console.log("▶ Sí, en 900173 con action_choice + historial cert → collecting AD578XY");
  mockPrisma.reset();
  const okRes = await postOdometer("Si, en 900173");
  const msg = String(okRes.message ?? "");
  assert.ok(!/Confirmar certificado/i.test(msg), `no debe armar certificado: ${msg.slice(0, 160)}`);
  assert.ok(
    /km|kilometr|fecha|hora|od[oó]metro/i.test(msg),
    `debe pedir km/fecha: ${msg.slice(0, 160)}`,
  );
  const pending = mockPrisma.getCustomer().pendingAction;
  assert.equal(pending?.type, "odometro", "pending sigue odometro");
  assert.notEqual(pending?.payload?.stage, ODOMETER_ACTION_CHOICE_STAGE);
  assert.equal(
    String(pending?.payload?.patente ?? "").replace(/\s+/g, "").toUpperCase(),
    "AD578XY",
    `patente resuelta=${pending?.payload?.patente}`,
  );
  assert.notEqual(
    String(pending?.payload?.patente ?? "").replace(/\s+/g, "").toUpperCase(),
    "AG382QD",
    "no reutiliza activeUnit de certificado",
  );
  assert.equal(pending?.payload?.turnLayer?.activeExpectation, "km");

  console.log("\n▶ Interno explícito inexistente → no reutiliza AG382QD");
  mockPrisma.reset();
  const missRes = await postOdometer("Si, en 999999");
  const missMsg = String(missRes.message ?? "");
  assert.ok(
    /no encontr[eé]|flota|listado|cu[aá]l|patente|interno/i.test(missMsg),
    `debe informar no encontrado o pedir aclaración: ${missMsg.slice(0, 160)}`,
  );
  assert.ok(!/Confirmar certificado/i.test(missMsg), "no certificado");
  const pendingMiss = mockPrisma.getCustomer().pendingAction;
  assert.equal(pendingMiss?.type, "odometro");
  const missPlate = String(pendingMiss?.payload?.patente ?? "")
    .replace(/\s+/g, "")
    .toUpperCase();
  assert.notEqual(missPlate, "AG382QD", "no debe continuar silenciosamente con activeUnit anterior");
  assert.equal(
    pendingMiss?.payload?.stage,
    "missing_plate",
    `tras interno inexistente → missing_plate (got ${pendingMiss?.payload?.stage})`,
  );
  assert.ok(/no encontr[eé]/i.test(missMsg), "mensaje explícito de no encontrado");

  console.log("\n✓ verify-odometer-live-pending-over-cert-history-e2e OK");
} finally {
  globalThis.fetch = originalFetch;
}
