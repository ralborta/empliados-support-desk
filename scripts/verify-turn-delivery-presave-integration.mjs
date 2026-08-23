#!/usr/bin/env node
/**
 * Integración: executor presave + deliverTurnToWhatsApp + contrato BBC.
 *
 * Uso: npx tsx scripts/verify-turn-delivery-presave-integration.mjs
 */
import assert from "node:assert/strict";
import { createDeliverTurnToWhatsApp } from "../src/lib/whatsappTurnDelivery.ts";
import {
  inboundDeliveryKeyFromParts,
  simulateExecutorPresaveOutbound,
} from "../src/lib/turnWhatsAppDeliveryLedger.ts";
import { shouldTurnSendWhatsAppToCustomer } from "../src/lib/waraInboundAudit.ts";

const PHONE = "5491133788190";
const WAMID = "wamid.HBgLNTQ5MTEzMzc4ODE5MBUCABEYFjE4MDgyM0E1";

function createMockPrisma() {
  const customer = { id: "cust-1", phone: PHONE, name: "Raúl A." };
  const ticket = {
    id: "ticket-1",
    customerId: customer.id,
    status: "OPEN",
    lastMessageAt: new Date(),
  };
  const messages = [];
  let seq = 0;

  const prisma = {
    customer: {
      findUnique: async ({ where }) =>
        where.phone === PHONE ? customer : null,
    },
    $queryRaw: async () => [],
    ticket: {
      findFirst: async () => ticket,
      update: async () => ticket,
    },
    ticketMessage: {
      create: async ({ data }) => {
        const id = `msg-${++seq}`;
        const row = { ...data, id, createdAt: new Date() };
        messages.push(row);
        return row;
      },
      findFirst: async ({ where, orderBy }) => {
        let pool = [...messages];
        if (where.ticket) {
          const t = where.ticket;
          if (t.customerId) {
            pool = pool.filter((m) => {
              const ticketRow = m.ticketId === ticket.id;
              return ticketRow && t.customerId === customer.id;
            });
          }
        }
        if (where.direction) pool = pool.filter((m) => m.direction === where.direction);
        if (where.from) pool = pool.filter((m) => m.from === where.from);
        if (where.text) pool = pool.filter((m) => m.text === where.text);
        if (where.externalMessageId) {
          pool = pool.filter((m) => m.externalMessageId === where.externalMessageId);
        }
        if (where.createdAt && typeof where.createdAt === "object") {
          const gte = where.createdAt.gte;
          if (gte) pool = pool.filter((m) => m.createdAt >= gte);
        }
        if (orderBy?.createdAt === "desc") pool.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return pool[0] ?? null;
      },
      findUnique: async ({ where }) =>
        messages.find((m) => m.id === where.id) ?? null,
      update: async ({ where, data }) => {
        const row = messages.find((m) => m.id === where.id);
        if (!row) return row;
        if (data.rawPayload) row.rawPayload = data.rawPayload;
        return row;
      },
    },
  };

  return { prisma, messages, customer, ticket };
}

function makePayload(message, wamid, selectionText) {
  return {
    message,
    summaryText: message,
    executor_s: "odometro",
    nextFlow: "reply",
    nextFlow_s: "reply",
    turnMessageId: wamid,
    turnSelectionText: selectionText,
  };
}

let sendCalls = 0;
const sentProviderIds = [];

async function mockSend(params) {
  sendCalls++;
  const id = `bbc-out-${sendCalls}`;
  sentProviderIds.push(id);
  return { providerMessageId: id, rawResponse: { ref: id } };
}

async function mockSendMessage() {
  return { ref: "media-only" };
}

const { prisma, messages, ticket } = createMockPrisma();
const deliver = createDeliverTurnToWhatsApp({
  prisma,
  sendWhatsApp: mockSend,
  sendWhatsAppMessage: mockSendMessage,
});

const odoText =
  "🛣️ *Odómetro*\n🚗 Unidad: AI 154 GC\nPasame el valor del odómetro en km y la fecha…";
const inboundText = "Odometro 900117";

console.log("— 1) Executor presave (panel) sin entrega WA —");
await simulateExecutorPresaveOutbound(prisma, {
  ticketId: ticket.id,
  text: odoText,
  executor: "odometro",
});
const presave = messages.find((m) => m.direction === "OUTBOUND" && m.text === odoText);
assert.ok(presave, "presave OUTBOUND existe");
assert.equal(presave.rawPayload?.waDeliveryState, "presaved");

await prisma.ticketMessage.create({
  data: {
    ticketId: ticket.id,
    direction: "INBOUND",
    from: "CUSTOMER",
    text: inboundText,
    externalMessageId: WAMID,
  },
});

console.log("— 2) Delivery envía por API tras presave —");
sendCalls = 0;
const first = await deliver(PHONE, makePayload(odoText, WAMID, inboundText));
assert.equal(sendCalls, 1, "un solo envío API");
assert.equal(first.skipResponse_s, "true", "BBC no reenvía tras API OK");
assert.equal(first.message, "", "message vacío para BBC");
assert.equal(first.waDelivery, "backend");
assert.ok(first.waOutboundProviderId, "id proveedor presente");

const inbound = messages.find((m) => m.externalMessageId === WAMID);
assert.equal(inbound?.rawPayload?.waTurnDelivery?.waDeliveryState, "delivered");
assert.equal(
  inbound?.rawPayload?.waTurnDelivery?.waOutboundProviderId,
  first.waOutboundProviderId,
);

console.log("— 3) Reintento mismo wamid → idempotente, sin segundo envío —");
sendCalls = 0;
const retry = await deliver(PHONE, makePayload(odoText, WAMID, inboundText));
assert.equal(sendCalls, 0, "sin segundo envío API");
assert.equal(retry.waDelivery, "idempotent_inbound");
assert.equal(retry.skipResponse_s, "true");

console.log("— 4) API falla → fallback BBC —");
const failDeliver = createDeliverTurnToWhatsApp({
  prisma,
  sendWhatsApp: async () => {
    throw new Error("API down");
  },
  sendWhatsAppMessage: mockSendMessage,
});
const WAMID2 = "wamid.HBgLNTQ5MTEzMzc4ODE5MBUCABEYFjE4MDgyM0B6";
await prisma.ticketMessage.create({
  data: {
    ticketId: ticket.id,
    direction: "INBOUND",
    from: "CUSTOMER",
    text: "Odometro 900118",
    externalMessageId: WAMID2,
  },
});
const failText = "No encontré la unidad en tu flota.";
const failed = await failDeliver(PHONE, makePayload(failText, WAMID2, "Odometro 900118"));
assert.equal(failed.skipResponse_s, "false", "BBC fallback activo");
assert.equal(failed.message, failText);
assert.equal(failed.waDelivery, "bbc_fallback");

console.log("— 5) WARA_TURN_BACKEND_SEND=false → BBC, sin API —");
const prevFlag = process.env.WARA_TURN_BACKEND_SEND;
process.env.WARA_TURN_BACKEND_SEND = "false";
assert.equal(shouldTurnSendWhatsAppToCustomer(), false);
sendCalls = 0;
const legacy = await deliver(PHONE, makePayload("Menú legacy BBC", "wamid.legacy-test", "Hola"));
assert.equal(sendCalls, 0, "sin API con flag false");
assert.equal(legacy.skipResponse_s, "false", "BBC entrega el texto");
assert.equal(legacy.message, "Menú legacy BBC");
if (prevFlag === undefined) delete process.env.WARA_TURN_BACKEND_SEND;
else process.env.WARA_TURN_BACKEND_SEND = prevFlag;

console.log("— 6) Dos turnos distintos, mismo texto → dos envíos —");
const WAMID3 = "wamid.HBgLNTQ5MTEzMzc4ODE5MBUCABEYFjE4MDgyM0C1";
const WAMID4 = "wamid.HBgLNTQ5MTEzMzc4ODE5MBUCABEYFjE4MDgyM0C2";
const sameReply = "Pasame la patente exacta de la unidad.";
await prisma.ticketMessage.create({
  data: {
    ticketId: ticket.id,
    direction: "INBOUND",
    from: "CUSTOMER",
    text: "Odometro 900119",
    externalMessageId: WAMID3,
  },
});
await prisma.ticketMessage.create({
  data: {
    ticketId: ticket.id,
    direction: "INBOUND",
    from: "CUSTOMER",
    text: "Odometro 900120",
    externalMessageId: WAMID4,
  },
});
sendCalls = 0;
await deliver(PHONE, makePayload(sameReply, WAMID3, "Odometro 900119"));
await deliver(PHONE, makePayload(sameReply, WAMID4, "Odometro 900120"));
assert.equal(sendCalls, 2, "dos envíos con mismo texto en turnos distintos");

console.log("— 7) Clave inbound estable (wamid vs inbound:id) —");
assert.equal(
  inboundDeliveryKeyFromParts({ turnMessageId: WAMID }),
  WAMID,
);
assert.equal(
  inboundDeliveryKeyFromParts({ inboundMessageId: "msg-42", inboundExternalMessageId: null }),
  "inbound:msg-42",
);

console.log("\n✓ verify-turn-delivery-presave-integration OK");
