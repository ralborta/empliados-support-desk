#!/usr/bin/env node
/**
 * Concurrencia: handleWhatsAppTurn + delivery (ledger/API mock).
 * Turno 1 aggregate demorado en executor; turno 2 capacidades por context.
 * Setup: solo limpia pendingAction (no reinicia empresa).
 *
 * Nota: las respuestas pueden completarse fuera de orden (p. ej. capacidades
 * antes que el aggregate lento). Esta prueba NO garantiza orden de recepción;
 * garantiza asociación por wamid, respuestas no vacías y pendingAction intacto.
 *
 * Uso: npx tsx scripts/verify-fleet-aggregate-concurrent-turns.mjs
 */
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { setBuilderBotHttpPostForTests } from "../src/lib/builderbot.ts";

const PHONE = "5491133788190";
const API_KEY = "test-fleet-aggregate-concurrent";
const WAMID_AGG =
  "wamid.HBgLNTQ5MTEzMzc4ODE5MBUCABEYFjE4MDgyM0FhZ2dyZWdhdGU";
const WAMID_CAP =
  "wamid.HBgLNTQ5MTEzMzc4ODE5MBUCABEYFjE4MDgyM0NhcGFiaWxpdHk";
const AGGREGATE_MSG = "¿Cuál es la unidad que tiene más tiempo sin reporte?";
const CAPABILITY_MSG = "Que gestiones puedo hacer con vos?";
const AGGREGATE_EXEC_DELAY_MS = 800;

process.env.BUILDERBOT_CONTEXT_API_KEY = API_KEY;
process.env.WARA_UTTERANCE_UNDERSTANDING = "false";
process.env.WARA_AGENT_MODE = "false";
process.env.WARA_TURN_BACKEND_SEND = "false";
process.env.WARA_INBOUND_AUDIT_ONLY = "true";
process.env.WARA_TURN_DEFER_EXECUTOR = "false";
process.env.NODE_ENV = "test";

const collectingPending = {
  type: "odometro",
  payload: {
    stage: "collecting",
    patente: "AG382QD",
    meterType: "odometro",
    actionChoiceConsumed: "corregir",
  },
  summary: "Pasame km y fecha",
  createdAt: new Date().toISOString(),
};

const activeUnit = {
  plate: "AG382QD",
  label: "AG 382 QD",
  source: "odometro",
  resolvedAt: new Date().toISOString(),
};

function readWaMeta(row) {
  return row?.rawPayload?.waTurnDelivery ?? {};
}

function createMockState() {
  const customerData = {
    id: "cust-fleet-concurrent",
    phone: PHONE,
    name: "Test Concurrent",
    companyName: "El Cacique S.A.",
    selectedCompanyContactId: 1,
    pendingAction: structuredClone(collectingPending),
    activeUnit: structuredClone(activeUnit),
    waraSessionToken: "mock-session",
    waraSessionAt: new Date(),
  };

  const ticket = {
    id: "ticket-fleet-concurrent",
    customerId: customerData.id,
    status: "OPEN",
    lastMessageAt: new Date(),
  };

  const messages = [];
  let seq = 0;
  const deliveries = [];

  function parsePayloadJson(raw) {
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  }

  function applyMockLedgerSql(sql, values) {
    if (sql.includes("FOR UPDATE")) return 1;
    if (!sql.includes("UPDATE")) return 0;

    const inboundId = values[1];
    const row = messages.find((m) => m.id === inboundId);
    if (!row) return 0;
    const meta = readWaMeta(row);
    const nextPayload = parsePayloadJson(values[0]);

    if (sql.includes("::bigint < $3")) {
      if (meta.waDeliveryState === "delivered") return 0;
      if (meta.waDeliveryState === "send_initiated" && meta.waOutboundProviderId) return 0;
      const staleThreshold = values[2];
      if (
        meta.waDeliveryState === "send_initiated" &&
        meta.sendInitiatedAt != null &&
        Number(meta.sendInitiatedAt) >= Number(staleThreshold)
      ) {
        return 0;
      }
      row.rawPayload = nextPayload;
      return 1;
    }

    const attemptId = values[2];
    if (meta.attemptId !== attemptId) return 0;

    if (sql.includes("waOutboundProviderId') IS NULL")) {
      if (meta.waOutboundProviderId) return 0;
      if (meta.waDeliveryState !== "send_initiated") return 0;
      row.rawPayload = nextPayload;
      return 1;
    }

    if (sql.includes("waDeliveryState') = 'send_initiated'")) {
      if (meta.waDeliveryState !== "send_initiated") return 0;
      row.rawPayload = nextPayload;
      return 1;
    }

    return 0;
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
          throw new Error("customer not found");
        }
        if (data.pendingAction !== undefined) {
          customerData.pendingAction =
            data.pendingAction === Prisma.JsonNull ? null : data.pendingAction;
        }
        if (data.activeUnit !== undefined) {
          customerData.activeUnit =
            data.activeUnit === Prisma.JsonNull ? null : data.activeUnit;
        }
        if (data.companyName !== undefined) customerData.companyName = data.companyName;
        if (data.selectedCompanyContactId !== undefined) {
          customerData.selectedCompanyContactId = data.selectedCompanyContactId;
        }
        return { ...customerData };
      },
    },
    ticket: {
      findFirst: async ({ where, orderBy } = {}) => {
        if (where?.customerId && where.customerId !== customerData.id) return null;
        return ticket;
      },
      update: async () => ticket,
    },
    ticketMessage: {
      findMany: async ({ where, orderBy, take, select } = {}) => {
        let pool = [...messages];
        if (where?.ticketId) pool = pool.filter((m) => m.ticketId === where.ticketId);
        if (where?.direction) pool = pool.filter((m) => m.direction === where.direction);
        if (where?.ticket?.customerId) {
          pool = pool.filter(
            (m) => m.ticketId === ticket.id && where.ticket.customerId === customerData.id,
          );
        }
        if (where?.createdAt?.gte) {
          const gte = where.createdAt.gte;
          pool = pool.filter((m) => m.createdAt >= gte);
        }
        if (orderBy?.createdAt === "desc") {
          pool.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        }
        if (take) pool = pool.slice(0, take);
        if (select) {
          return pool.map((m) => {
            const out = {};
            for (const [k, v] of Object.entries(select)) {
              if (v) out[k] = m[k];
            }
            return out;
          });
        }
        return pool;
      },
      findFirst: async ({ where, orderBy } = {}) => {
        let pool = [...messages];
        if (where?.ticket?.customerId) {
          pool = pool.filter(
            (m) => m.ticketId === ticket.id && where.ticket.customerId === customerData.id,
          );
        }
        if (where?.direction) pool = pool.filter((m) => m.direction === where.direction);
        if (where?.from) pool = pool.filter((m) => m.from === where.from);
        if (where?.externalMessageId) {
          pool = pool.filter((m) => m.externalMessageId === where.externalMessageId);
        }
        if (where?.NOT) {
          const not = where.NOT;
          if (not.direction && not.from) {
            pool = pool.filter(
              (m) => m.direction !== not.direction || m.from !== not.from,
            );
          }
        }
        if (where?.createdAt?.gte) {
          const gte = where.createdAt.gte;
          pool = pool.filter((m) => m.createdAt >= gte);
        }
        if (orderBy?.createdAt === "desc") {
          pool.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        }
        return pool[0] ?? null;
      },
      findUnique: async ({ where }) =>
        messages.find((m) => m.id === where.id) ?? null,
      create: async ({ data }) => {
        const id = `msg-${++seq}`;
        const row = {
          ...data,
          id,
          createdAt: new Date(),
          rawPayload: data.rawPayload ?? {},
        };
        messages.push(row);
        return row;
      },
      update: async ({ where, data }) => {
        const row = messages.find((m) => m.id === where.id);
        if (!row) return row;
        if (data.rawPayload) row.rawPayload = data.rawPayload;
        return row;
      },
      count: async ({ where } = {}) => {
        let pool = [...messages];
        if (where?.ticketId) pool = pool.filter((m) => m.ticketId === where.ticketId);
        if (where?.direction) pool = pool.filter((m) => m.direction === where.direction);
        if (where?.createdAt?.gt) {
          const gt = where.createdAt.gt;
          pool = pool.filter((m) => m.createdAt > gt);
        }
        if (where?.createdAt?.gte) {
          const gte = where.createdAt.gte;
          pool = pool.filter((m) => m.createdAt >= gte);
        }
        return pool.length;
      },
    },
    $queryRaw: async () => [],
    $transaction: async (fn) => fn(mockPrisma),
    $executeRaw: async (strings, ...values) =>
      applyMockLedgerSql(strings.join("?"), values),
    $executeRawUnsafe: async (sql, ...values) => applyMockLedgerSql(sql, values),
    recordDelivery: (wamid, body, message, path) => {
      deliveries.push({ wamid, body, message, path });
    },
    getCustomer: () => customerData,
    getDeliveries: () => deliveries,
    getMessages: () => messages,
    clearPendingOnly: () => {
      customerData.pendingAction = null;
    },
    restorePending: () => {
      customerData.pendingAction = structuredClone(collectingPending);
    },
  };

  return mockPrisma;
}

const mockPrisma = createMockState();
globalThis.prisma = mockPrisma;

const completionOrder = [];
let aggExecutorDelayEntered = false;

let apiSendSeq = 0;
setBuilderBotHttpPostForTests(async () => {
  apiSendSeq++;
  return { data: { number: PHONE, message: "ok", waited: true } };
});

const { runTurnExecutorPhase } = await import("../src/lib/whatsappTurnExecutor.ts");
const { createDeliverTurnToWhatsApp } = await import("../src/lib/whatsappTurnDelivery.ts");
const { handleWhatsAppTurn } = await import("../src/lib/whatsappTurn.ts");
const { customerRegisteredContextResponse } = await import("../src/lib/builderbotCustomerContext.ts");
const { persistCustomerInbound } = await import("../src/lib/customerTicketInquiry.ts");
const { clearPendingAction } = await import("../src/lib/pendingAction.ts");
const { buildAtilioHelpCapabilitiesReply } = await import("../src/lib/waraApi.ts");
const { buildAggregateFleetComparisonLimitReply } = await import("../src/lib/fleetQueryKind.ts");

let sendCalls = 0;
async function mockSend(params) {
  sendCalls++;
  const id = `bbc-out-${sendCalls}`;
  return { providerMessageId: id, rawResponse: { ref: id } };
}
async function mockSendMessage() {
  return { ref: "media-only" };
}

const deliver = createDeliverTurnToWhatsApp({
  prisma: mockPrisma,
  sendWhatsApp: mockSend,
  sendWhatsAppMessage: mockSendMessage,
});

/**
 * BBC real para aggregate: context (router) → execute demorado → delivery mock.
 */
async function simulateDelayedAggregateTurn(wamid) {
  const ctxRes = await customerRegisteredContextResponse(PHONE, {
    selectionText: AGGREGATE_MSG,
  });
  const context = await ctxRes.json().catch(() => ({}));
  const nextFlow = String(context.nextFlow ?? context.nextFlow_s ?? "");
  assert.equal(nextFlow, "router", "aggregate → router en context");

  await persistCustomerInbound(PHONE, AGGREGATE_MSG, {
    source: "whatsapp_turn",
    messageId: wamid,
  }).catch(() => undefined);

  aggExecutorDelayEntered = true;
  await new Promise((r) => setTimeout(r, AGGREGATE_EXEC_DELAY_MS));

  const exec = await runTurnExecutorPhase({
    rawPhone: PHONE,
    selectionText: AGGREGATE_MSG,
    apiKey: API_KEY,
  });
  const delivered = await deliver(PHONE, {
    message: exec.message,
    summaryText: exec.message,
    executor: exec.executor,
    executor_s: exec.executor,
    nextFlow: "reply",
    nextFlow_s: "reply",
    turnMessageId: wamid,
    turnSelectionText: AGGREGATE_MSG,
    ok: exec.ok,
    ok_s: exec.ok ? "true" : "false",
  });
  mockPrisma.recordDelivery(wamid, AGGREGATE_MSG, exec.message, "context+execute");
  completionOrder.push(wamid);
  return {
    wamid,
    body: AGGREGATE_MSG,
    message: exec.message,
    path: "context+execute",
    contextTurn: context,
    delivered,
  };
}

/**
 * Turno completo vía handleWhatsAppTurn + delivery real del módulo.
 */
async function simulateCapabilityTurn(wamid) {
  const contextTurn = await handleWhatsAppTurn({
    rawPhone: PHONE,
    body: CAPABILITY_MSG,
    messageId: wamid,
    apiKey: API_KEY,
  });
  const message = String(contextTurn.message ?? contextTurn.summaryText ?? "").trim();
  mockPrisma.recordDelivery(wamid, CAPABILITY_MSG, message, "handleWhatsAppTurn-reply");
  completionOrder.push(wamid);
  return {
    wamid,
    body: CAPABILITY_MSG,
    message,
    path: "handleWhatsAppTurn-reply",
    contextTurn,
  };
}

console.log("— Setup: solo clearPendingAction —");
await clearPendingAction(mockPrisma, PHONE);
assert.equal(mockPrisma.getCustomer().pendingAction, null);
mockPrisma.restorePending();
assert.equal(mockPrisma.getCustomer().pendingAction?.payload?.stage, "collecting");

console.log("\n— Concurrencia: aggregate lento + capacidades rápido —");
sendCalls = 0;
let aggDoneAt = 0;
let capDoneAt = 0;

const aggPromise = simulateDelayedAggregateTurn(WAMID_AGG).then((r) => {
  aggDoneAt = Date.now();
  return r;
});

const waitAggDelay = async () => {
  const deadline = Date.now() + 5000;
  while (!aggExecutorDelayEntered && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.ok(aggExecutorDelayEntered, "aggregate entró en fase execute demorada");
};
await waitAggDelay();

const capPromise = simulateCapabilityTurn(WAMID_CAP).then((r) => {
  capDoneAt = Date.now();
  return r;
});

const [resAgg, resCap] = await Promise.all([aggPromise, capPromise]);

assert.ok(capDoneAt > 0 && aggDoneAt > 0, "ambos turnos completaron");
// Fuera de orden permitido: no se afirma orden de recepción.
assert.equal(completionOrder.length, 2, "dos turnos registrados en completionOrder");
assert.ok(completionOrder.includes(WAMID_CAP), "wamid capacidades presente");
assert.ok(completionOrder.includes(WAMID_AGG), "wamid aggregate presente");

const deliveries = mockPrisma.getDeliveries();
assert.equal(deliveries.length, 2, "dos respuestas registradas");

const byWamid = Object.fromEntries(deliveries.map((d) => [d.wamid, d]));

assert.ok(byWamid[WAMID_AGG]?.message?.trim().length > 20, "aggregate no vacío");
assert.ok(byWamid[WAMID_CAP]?.message?.trim().length > 20, "capability no vacío");

assert.equal(
  byWamid[WAMID_AGG].message,
  buildAggregateFleetComparisonLimitReply(),
  "wamid aggregate → límite fijo",
);
assert.equal(
  byWamid[WAMID_CAP].message,
  buildAtilioHelpCapabilitiesReply(undefined, "El Cacique S.A."),
  "wamid capability → menú capacidades",
);

assert.equal(byWamid[WAMID_AGG].path, "context+execute", "aggregate vía context+execute");
assert.equal(byWamid[WAMID_CAP].path, "handleWhatsAppTurn-reply", "capability vía handleWhatsAppTurn");

assert.notEqual(byWamid[WAMID_AGG].message, byWamid[WAMID_CAP].message, "respuestas distintas");
assert.equal(byWamid[WAMID_AGG].body, AGGREGATE_MSG);
assert.equal(byWamid[WAMID_CAP].body, CAPABILITY_MSG);

assert.equal(resAgg.path, "context+execute");
assert.equal(resCap.path, "handleWhatsAppTurn-reply");
assert.equal(resAgg.delivered?.waDelivery, "bbc", "aggregate entregado vía BBC path (BACKEND_SEND=false)");
assert.ok(resCap.message.length > 20, "capability respondió por handleWhatsAppTurn");

const inboundAgg = mockPrisma
  .getMessages()
  .find((m) => m.externalMessageId === WAMID_AGG && m.direction === "INBOUND");
assert.ok(inboundAgg, "inbound aggregate persistido con wamid");

console.log("\n— Trámite activo preservado tras capacidades —");
assert.equal(
  mockPrisma.getCustomer().pendingAction?.payload?.stage,
  "collecting",
  "pendingAction collecting intacto",
);
assert.equal(mockPrisma.getCustomer().activeUnit?.plate, "AG382QD", "activeUnit intacta");

console.log("\n✓ verify-fleet-aggregate-concurrent-turns OK");
