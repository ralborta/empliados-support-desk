#!/usr/bin/env node
/**
 * Integración: executor presave + deliverTurnToWhatsApp + contrato BBC + builderbot.
 *
 * Uso: npx tsx scripts/verify-turn-delivery-presave-integration.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const { createDeliverTurnToWhatsApp } = await import("../src/lib/whatsappTurnDelivery.ts");
const {
  inboundDeliveryKeyFromParts,
  releaseInboundDeliverySendRight,
  SEND_INITIATED_STALE_MS,
  simulateExecutorPresaveOutbound,
  tryAcquireInboundDeliverySendRight,
} = await import("../src/lib/turnWhatsAppDeliveryLedger.ts");
const { shouldTurnSendWhatsAppToCustomer } = await import("../src/lib/waraInboundAudit.ts");

const PHONE = "5491133788190";
const WAMID = "wamid.HBgLNTQ5MTEzMzc4ODE5MBUCABEYFjE4MDgyM0E1";

function readWaMeta(row) {
  return row?.rawPayload?.waTurnDelivery ?? {};
}

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

  const prisma = {
    customer: {
      findUnique: async ({ where }) =>
        where.phone === PHONE ? customer : null,
    },
    $queryRaw: async () => [],
    $transaction: async (fn) => fn(prisma),
    $executeRaw: async (strings, ...values) =>
      applyMockLedgerSql(strings.join("?"), values),
    $executeRawUnsafe: async (sql, ...values) => applyMockLedgerSql(sql, values),
    ticket: {
      findFirst: async () => ticket,
      update: async () => ticket,
    },
    ticketMessage: {
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
      findFirst: async ({ where, orderBy }) => {
        let pool = [...messages];
        if (where.ticket) {
          const t = where.ticket;
          if (t.customerId) {
            pool = pool.filter(
              (m) => m.ticketId === ticket.id && t.customerId === customer.id,
            );
          }
        }
        if (where.direction) pool = pool.filter((m) => m.direction === where.direction);
        if (where.from) pool = pool.filter((m) => m.from === where.from);
        if (where.text) pool = pool.filter((m) => m.text === where.text);
        if (where.externalMessageId) {
          pool = pool.filter((m) => m.externalMessageId === where.externalMessageId);
        }
        if (where.NOT) {
          const not = where.NOT;
          if (not.direction && not.from) {
            pool = pool.filter(
              (m) => m.direction !== not.direction || m.from !== not.from,
            );
          }
        }
        if (where.createdAt && typeof where.createdAt === "object") {
          const gte = where.createdAt.gte;
          if (gte) pool = pool.filter((m) => m.createdAt >= gte);
        }
        if (orderBy?.createdAt === "desc") {
          pool.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        }
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

async function mockSend(params) {
  sendCalls++;
  const id = `bbc-out-${sendCalls}`;
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
assert.equal(readWaMeta(inbound).waDeliveryState, "delivered");
assert.equal(readWaMeta(inbound).waOutboundProviderId, first.waOutboundProviderId);

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
assert.equal(inboundDeliveryKeyFromParts({ turnMessageId: WAMID }), WAMID);
assert.equal(
  inboundDeliveryKeyFromParts({
    inboundMessageId: "msg-42",
    inboundExternalMessageId: null,
  }),
  "inbound:msg-42",
);

console.log("— 8) Concurrencia: dos deliveries mismo wamid → un solo envío API —");
const WAMID_CONC = "wamid.HBgLNTQ5MTEzMzc4ODE5MBUCABEYFjE4MDgyM0D7";
const inboundConc = await prisma.ticketMessage.create({
  data: {
    ticketId: ticket.id,
    direction: "INBOUND",
    from: "CUSTOMER",
    text: "Odometro 900121",
    externalMessageId: WAMID_CONC,
  },
});
sendCalls = 0;
const [concA, concB] = await Promise.all([
  deliver(PHONE, makePayload("Respuesta concurrente", WAMID_CONC, "Odometro 900121")),
  deliver(PHONE, makePayload("Respuesta concurrente", WAMID_CONC, "Odometro 900121")),
]);
assert.equal(sendCalls, 1, "solo un POST API bajo concurrencia");
const concResults = [concA.waDelivery, concB.waDelivery].sort();
assert.ok(
  concResults.includes("backend") || concResults.includes("idempotent_inbound"),
  "un resultado entrega y el otro idempotente/in_progress",
);
assert.equal(readWaMeta(inboundConc).waDeliveryState, "delivered");

console.log("— 9) Crash tras API: send_initiated stale → reintento seguro —");
const WAMID_CRASH = "wamid.HBgLNTQ5MTEzMzc4ODE5MBUCABEYFjE4MDgyM0D8";
const inboundCrash = await prisma.ticketMessage.create({
  data: {
    ticketId: ticket.id,
    direction: "INBOUND",
    from: "CUSTOMER",
    text: "Odometro 900122",
    externalMessageId: WAMID_CRASH,
  },
});
const keyCrash = inboundDeliveryKeyFromParts({ turnMessageId: WAMID_CRASH });
const acquired = await tryAcquireInboundDeliverySendRight(
  inboundCrash.id,
  keyCrash,
  prisma,
);
assert.equal(acquired.status, "acquired");
const crashInbound = messages.find((m) => m.id === inboundCrash.id);
crashInbound.rawPayload = {
  ...crashInbound.rawPayload,
  waTurnDelivery: {
    inboundDeliveryKey: keyCrash,
    waDeliveryState: "send_initiated",
    sendInitiatedAt: Date.now() - SEND_INITIATED_STALE_MS - 1000,
  },
};
sendCalls = 0;
const recovered = await deliver(
  PHONE,
  makePayload("Recuperación tras crash", WAMID_CRASH, "Odometro 900122"),
);
assert.equal(sendCalls, 1, "reintento tras send_initiated stale");
assert.equal(recovered.waDelivery, "backend");
assert.equal(readWaMeta(crashInbound).waDeliveryState, "delivered");

console.log("— 10) Webhook presave inbound antes de delivery —");
const WAMID_WEBHOOK = "wamid.HBgLNTQ5MTEzMzc4ODE5MBUCABEYFjE4MDgyM0D9";
const webhookInbound = await prisma.ticketMessage.create({
  data: {
    ticketId: ticket.id,
    direction: "INBOUND",
    from: "CUSTOMER",
    text: "Odometro 900123",
    externalMessageId: WAMID_WEBHOOK,
    rawPayload: {
      source: "whatsapp_inbound_webhook",
      eventName: "message.incoming",
      messageId: WAMID_WEBHOOK,
    },
  },
});
sendCalls = 0;
const webhookDelivery = await deliver(
  PHONE,
  makePayload("Tras webhook inbound", WAMID_WEBHOOK, "Odometro 900123"),
);
assert.equal(sendCalls, 1, "delivery con inbound webhook previo");
assert.equal(webhookDelivery.waDelivery, "backend");
assert.equal(readWaMeta(webhookInbound).waDeliveryState, "delivered");

console.log("— 11) skippedDuplicate sin providerId → no BBC fallback —");
const WAMID_SKIP = "wamid.HBgLNTQ5MTEzMzc4ODE5MBUCABEYFjE4MDgyM0EA";
await prisma.ticketMessage.create({
  data: {
    ticketId: ticket.id,
    direction: "INBOUND",
    from: "CUSTOMER",
    text: "Odometro 900124",
    externalMessageId: WAMID_SKIP,
  },
});
const skipDeliver = createDeliverTurnToWhatsApp({
  prisma,
  sendWhatsApp: async () => ({ skippedDuplicate: true }),
  sendWhatsAppMessage: mockSendMessage,
});
const skipped = await skipDeliver(
  PHONE,
  makePayload("Skip dup test", WAMID_SKIP, "Odometro 900124"),
);
assert.equal(skipped.skipResponse_s, "true", "no activar BBC");
assert.equal(skipped.waDelivery, "idempotent_api_dedup");
assert.equal(skipped.message, "");

console.log("— 12) builderbot.ts: dedup textual eliminado —");
const builderbotSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../src/lib/builderbot.ts"),
  "utf8",
);
assert.ok(!builderbotSrc.includes("shouldSkipDuplicateWaSend"), "sin shouldSkipDuplicateWaSend");
assert.ok(!builderbotSrc.includes("RECENT_WA_SEND_DEDUP_MS"), "sin ventana dedup 8s");
assert.ok(!builderbotSrc.includes("skippedDuplicate"), "sendWhatsAppMessage no devuelve skippedDuplicate");
const runtimeDedup = spawnSync("npx", ["tsx", "scripts/verify-builderbot-no-text-dedup.mjs"], {
  cwd: join(dirname(fileURLToPath(import.meta.url)), ".."),
  encoding: "utf8",
});
assert.equal(runtimeDedup.status, 0, `builderbot runtime dedup: ${runtimeDedup.stderr || runtimeDedup.stdout}`);

console.log("— 13) API OK + fallo mark delivered → delivery_persist_failed, sin BBC ni reenvío —");
const WAMID_MARK_FAIL = "wamid.HBgLNTQ5MTEzMzc4ODE5MBUCABEYFjE4MDgyM0EB";
await prisma.ticketMessage.create({
  data: {
    ticketId: ticket.id,
    direction: "INBOUND",
    from: "CUSTOMER",
    text: "Odometro 900125",
    externalMessageId: WAMID_MARK_FAIL,
  },
});
const markFailPrisma = {
  ...prisma,
  $transaction: async (fn) => fn(markFailPrisma),
  $executeRawUnsafe: async (sql, ...args) => {
    const payload =
      typeof args[0] === "string" ? JSON.parse(args[0]) : args[0];
    if (payload?.waTurnDelivery?.waDeliveryState === "delivered") {
      throw new Error("simulated crash before delivered mark");
    }
    return prisma.$executeRawUnsafe(sql, ...args);
  },
};
const crashDeliver = createDeliverTurnToWhatsApp({
  prisma: markFailPrisma,
  sendWhatsApp: mockSend,
  sendWhatsAppMessage: mockSendMessage,
});
sendCalls = 0;
const crashResult = await crashDeliver(
  PHONE,
  makePayload("Crash mark delivered", WAMID_MARK_FAIL, "Odometro 900125"),
);
assert.equal(sendCalls, 1, "exactamente un POST API");
assert.equal(crashResult.waDelivery, "delivery_persist_failed");
assert.equal(crashResult.skipResponse_s, "true", "sin BBC fallback");
assert.equal(crashResult.message, "");
assert.ok(crashResult.waOutboundProviderId, "provider id en resultado");
sendCalls = 0;
const afterCrash = await deliver(
  PHONE,
  makePayload("Crash mark delivered", WAMID_MARK_FAIL, "Odometro 900125"),
);
assert.equal(sendCalls, 0, "sin segundo POST inmediato");
assert.ok(
  afterCrash.waDelivery === "idempotent_inbound" ||
    afterCrash.waDelivery === "send_in_progress",
);

console.log("— 14) Carrera: A vence, B reclama, A no puede liberar tarde —");
const WAMID_RACE = "wamid.HBgLNTQ5MTEzMzc4ODE5MBUCABEYFjE4MDgyM0EC";
const inboundRace = await prisma.ticketMessage.create({
  data: {
    ticketId: ticket.id,
    direction: "INBOUND",
    from: "CUSTOMER",
    text: "Odometro 900126",
    externalMessageId: WAMID_RACE,
  },
});
const keyRace = inboundDeliveryKeyFromParts({ turnMessageId: WAMID_RACE });
const acquireA = await tryAcquireInboundDeliverySendRight(
  inboundRace.id,
  keyRace,
  prisma,
);
assert.equal(acquireA.status, "acquired");
const attemptA = acquireA.attemptId;
const raceRow = messages.find((m) => m.id === inboundRace.id);
raceRow.rawPayload = {
  ...raceRow.rawPayload,
  waTurnDelivery: {
    inboundDeliveryKey: keyRace,
    waDeliveryState: "send_initiated",
    sendInitiatedAt: Date.now() - SEND_INITIATED_STALE_MS - 5000,
    attemptId: attemptA,
  },
};
const acquireB = await tryAcquireInboundDeliverySendRight(
  inboundRace.id,
  keyRace,
  prisma,
);
assert.equal(acquireB.status, "acquired");
const attemptB = acquireB.attemptId;
assert.notEqual(attemptA, attemptB);
const lateRelease = await releaseInboundDeliverySendRight(
  inboundRace.id,
  keyRace,
  attemptA,
  prisma,
);
assert.equal(lateRelease, false, "A no libera reserva de B");
const raceMeta = readWaMeta(messages.find((m) => m.id === inboundRace.id));
assert.equal(raceMeta.attemptId, attemptB);
assert.equal(raceMeta.waDeliveryState, "send_initiated");

console.log("— 15) record accepted falla, stale 120s, reintento → sin segundo POST —");
const WAMID_RECORD_FAIL = "wamid.HBgLNTQ5MTEzMzc4ODE5MBUCABEYFjE4MDgyM0ED";
const inboundRecordFail = await prisma.ticketMessage.create({
  data: {
    ticketId: ticket.id,
    direction: "INBOUND",
    from: "CUSTOMER",
    text: "Odometro 900127",
    externalMessageId: WAMID_RECORD_FAIL,
  },
});
const recordFailPrisma = {
  ...prisma,
  $transaction: async (fn) => fn(recordFailPrisma),
  $executeRawUnsafe: async (sql, ...args) => {
    const payload =
      typeof args[0] === "string" ? JSON.parse(args[0]) : args[0];
    const meta = payload?.waTurnDelivery;
    if (
      sql.includes("waOutboundProviderId') IS NULL") &&
      meta?.waOutboundProviderId
    ) {
      throw new Error("simulated recordInboundWaProviderAccepted fail");
    }
    return prisma.$executeRawUnsafe(sql, ...args);
  },
};
const recordFailDeliver = createDeliverTurnToWhatsApp({
  prisma: recordFailPrisma,
  sendWhatsApp: mockSend,
  sendWhatsAppMessage: mockSendMessage,
});
sendCalls = 0;
const recordFailResult = await recordFailDeliver(
  PHONE,
  makePayload("Record fail stash", WAMID_RECORD_FAIL, "Odometro 900127"),
);
assert.equal(sendCalls, 1, "un POST API en primer intento");
assert.equal(recordFailResult.waDelivery, "delivery_persist_failed");
assert.ok(recordFailResult.waOutboundProviderId, "provider id en resultado");
const recordFailRow = messages.find((m) => m.id === inboundRecordFail.id);
assert.ok(readWaMeta(recordFailRow).waOutboundProviderId, "stash en inbound tras fallo record");
recordFailRow.rawPayload = {
  ...recordFailRow.rawPayload,
  waTurnDelivery: {
    ...readWaMeta(recordFailRow),
    sendInitiatedAt: Date.now() - SEND_INITIATED_STALE_MS - 8000,
  },
};
sendCalls = 0;
const staleRetry = await deliver(
  PHONE,
  makePayload("Record fail stash", WAMID_RECORD_FAIL, "Odometro 900127"),
);
assert.equal(sendCalls, 0, "sin segundo POST tras 120s stale");
assert.equal(staleRetry.waDelivery, "idempotent_inbound");

console.log("\n✓ verify-turn-delivery-presave-integration OK (15 escenarios)");
