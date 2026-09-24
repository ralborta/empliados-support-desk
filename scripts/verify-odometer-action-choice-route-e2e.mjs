#!/usr/bin/env node
/**
 * E2E con mock Prisma — recorrido real POST odómetro → expectativa DB → POST Corregir.
 *
 * Uso: npx tsx scripts/verify-odometer-action-choice-route-e2e.mjs
 */
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { NextRequest } from "next/server";

const PHONE = "5491133788190";
const API_KEY = "test-odometer-action-choice-e2e";

process.env.BUILDERBOT_CONTEXT_API_KEY = API_KEY;
process.env.WARA_DIALOGUE_AI_ODOMETRO = "false";
process.env.NODE_ENV = "test";

const CERT_THREAD_LINES = [
  "Cliente: Odometro 900118",
  "Atilio: Unidad AG 382 QD. Pasame el valor del odómetro en km y la fecha.",
  "Cliente: Confirmo",
  "Atilio: Listo, certificado para AG 382 QD: https://example.com/cert.pdf",
];

function seedThreadMessages() {
  return CERT_THREAD_LINES.map((line, i) => {
    const isClient = line.startsWith("Cliente:");
    return {
      id: `m${i}`,
      ticketId: "ticket-1",
      direction: isClient ? "INBOUND" : "OUTBOUND",
      from: isClient ? "CUSTOMER" : "BOT",
      text: line.replace(/^Cliente: |^Atilio: /, ""),
      createdAt: new Date(Date.now() - (CERT_THREAD_LINES.length - i) * 120000),
    };
  });
}

function buildThreadText(messages) {
  return [...messages]
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((m) =>
      m.from === "CUSTOMER" || m.direction === "INBOUND"
        ? `Cliente: ${m.text}`
        : `Atilio: ${m.text}`,
    )
    .join("\n");
}

function createMockState() {
  const threadMessages = seedThreadMessages();
  const customerData = {
    id: "cust-odometer-action-choice",
    phone: PHONE,
    name: "Test Action Choice E2E",
    pendingAction: null,
    activeUnit: {
      plate: "AG382QD",
      label: "AG 382 QD",
      source: "certificado",
      resolvedAt: new Date().toISOString(),
    },
  };
  const ticket = {
    id: "ticket-1",
    customerId: customerData.id,
    status: "OPEN",
    lastMessageAt: new Date(),
  };

  let persistFailStages = new Set();

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

  function resetForHappyPath() {
    threadMessages.length = 0;
    threadMessages.push(...seedThreadMessages());
    customerData.pendingAction = null;
    customerData.activeUnit = {
      plate: "AG382QD",
      label: "AG 382 QD",
      source: "certificado",
      resolvedAt: new Date().toISOString(),
    };
    persistFailStages = new Set();
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
      update: async ({ where, data }) => {
        if (where.phone !== PHONE && where.id !== customerData.id) {
          throw new Error("customer not found for update");
        }
        const stage =
          data.pendingAction &&
          data.pendingAction !== Prisma.JsonNull &&
          data.pendingAction.payload?.stage;
        if (persistFailStages.size > 0 && stage && persistFailStages.has(stage)) {
          throw new Error(`simulated pendingAction persist failure (${stage})`);
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
    setPersistFailStages: (stages) => {
      persistFailStages = new Set(stages);
    },
    resetForHappyPath,
    getCustomer: () => customerData,
    getThreadMessages: () => threadMessages,
  };

  return mockPrisma;
}

const mockPrisma = createMockState();
globalThis.prisma = mockPrisma;

const { POST } = await import("../src/app/api/wara/odometro-horometro/route.ts");
const { classifyTurnExecutor } = await import("../src/lib/whatsappTurnRouter.ts");
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

console.log("▶ Persistencia fallida en POST Odometro (odometer_action_choice)");
mockPrisma.setPersistFailStages(["odometer_action_choice"]);
const failOdometroRes = await postOdometer("Odometro");
assert.equal(failOdometroRes.error, "pending_action_persist_failed");
assert.ok(
  !/Corregir o actualizar el kilometraje/i.test(String(failOdometroRes.message)),
  "no envía menú corregir/actualizar sin expectativa",
);
assert.match(String(failOdometroRes.message), /unidad/i);
assert.equal(mockPrisma.getCustomer().pendingAction, null);

console.log("\n▶ Persistencia fallida en POST Corregir (collecting)");
mockPrisma.resetForHappyPath();
const clarifyRes = await postOdometer("Odometro");
assert.equal(
  mockPrisma.getCustomer().pendingAction?.payload?.stage,
  ODOMETER_ACTION_CHOICE_STAGE,
);
mockPrisma.setPersistFailStages(["collecting"]);
const failCorregirRes = await postOdometer("Corregir");
assert.equal(failCorregirRes.error, "pending_action_persist_failed");
assert.ok(
  !/AG\s*382|382\s*QD/i.test(String(failCorregirRes.message)),
  "no envía prompt km/fecha para unidad concreta si collecting no persistió",
);
assert.match(String(failCorregirRes.message), /unidad/i);
assert.equal(
  mockPrisma.getCustomer().pendingAction?.payload?.stage,
  ODOMETER_ACTION_CHOICE_STAGE,
  "expectativa odometer_action_choice intacta tras fallo en collecting",
);

console.log("\n▶ Recorrido POST Odometro → Corregir (mock DB)");
mockPrisma.resetForHappyPath();

const step1 = await postOdometer("Odometro");
const customerAfterClarify = mockPrisma.getCustomer();

assert.ok(step1.message, "POST Odometro devuelve mensaje");
assert.equal(
  customerAfterClarify.pendingAction?.payload?.stage,
  ODOMETER_ACTION_CHOICE_STAGE,
  "pendingAction.stage = odometer_action_choice",
);
assert.equal(customerAfterClarify.pendingAction?.payload?.patente, "AG382QD");

const threadAfterClarify = buildThreadText(mockPrisma.getThreadMessages());
assert.equal(
  classifyTurnExecutor("Corregir", threadAfterClarify, customerAfterClarify.pendingAction),
  "odometro",
  "Corregir → odometro con expectativa DB",
);
assert.equal(
  classifyTurnExecutor("Corregir", threadAfterClarify),
  "unidades",
  "sin expectativa DB no infiere del menú del bot",
);

const step4 = await postOdometer("Corregir");
const customerAfterCorregir = mockPrisma.getCustomer();

assert.equal(customerAfterCorregir.pendingAction?.payload?.stage, "collecting");
assert.match(String(step4.message), /km/i);
assert.match(String(step4.message), /fecha/i);
assert.ok(/AG\s*382|382\s*QD/i.test(String(step4.message)));

const threadAfterCorregir = buildThreadText(mockPrisma.getThreadMessages());
assert.notEqual(
  classifyTurnExecutor("128000", threadAfterCorregir, customerAfterCorregir.pendingAction),
  "unidades",
);

console.log("\n✓ E2E route odometer_action_choice OK");
