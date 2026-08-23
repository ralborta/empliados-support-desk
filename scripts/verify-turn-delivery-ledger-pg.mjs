#!/usr/bin/env node
/**
 * Ledger de entrega WA contra PostgreSQL real (JSON.stringify::jsonb + attemptId).
 * Requiere DATABASE_URL.
 *
 * Uso: npx tsx scripts/verify-turn-delivery-ledger-pg.mjs
 */
import { PrismaClient } from "@prisma/client";
import {
  inboundDeliveryKeyFromParts,
  markInboundDeliveryDelivered,
  recordInboundWaProviderAccepted,
  releaseInboundDeliverySendRight,
  SEND_INITIATED_STALE_MS,
  tryAcquireInboundDeliverySendRight,
} from "../src/lib/turnWhatsAppDeliveryLedger.ts";

const prisma = new PrismaClient();
const TEST_PHONE = "5490000099001";
const TEST_WAMID = "wamid.HBgLNTQ5MTEzMzc4ODE5MBUCABEYFjE4MDgyM0PG";

let failures = 0;
function assert(cond, label) {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}

function readMeta(rawPayload) {
  if (!rawPayload || typeof rawPayload !== "object") return {};
  const nested = rawPayload.waTurnDelivery;
  return nested && typeof nested === "object" ? nested : {};
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.log("SKIP: falta DATABASE_URL");
    return;
  }

  console.log("— Ledger PG: acquire JSON.stringify::jsonb + attemptId —");

  await prisma.customer.deleteMany({ where: { phone: TEST_PHONE } });
  const customer = await prisma.customer.create({
    data: { phone: TEST_PHONE, name: "Ledger PG Test" },
  });
  const ticket = await prisma.ticket.create({
    data: {
      customerId: customer.id,
      code: `PG-LEDGER-${Date.now()}`,
      contactName: "Ledger PG Test",
      title: "Ledger PG",
      status: "IN_PROGRESS",
      priority: "NORMAL",
      category: "TECH_SUPPORT",
      channel: "WHATSAPP",
      lastMessageAt: new Date(),
    },
  });
  const inbound = await prisma.ticketMessage.create({
    data: {
      ticketId: ticket.id,
      direction: "INBOUND",
      from: "CUSTOMER",
      text: "Odometro pg test",
      externalMessageId: TEST_WAMID,
      rawPayload: { source: "pg_test" },
    },
  });

  const key = inboundDeliveryKeyFromParts({ turnMessageId: TEST_WAMID });
  assert(!!key, "clave inbound derivada");

  try {
    const first = await tryAcquireInboundDeliverySendRight(inbound.id, key, prisma);
    assert(first.status === "acquired", "primer acquire OK");
    const attemptA = first.status === "acquired" ? first.attemptId : "";

    const row1 = await prisma.ticketMessage.findUnique({
      where: { id: inbound.id },
      select: { rawPayload: true },
    });
    const meta1 = readMeta(row1?.rawPayload);
    assert(meta1.waDeliveryState === "send_initiated", "estado send_initiated en PG");
    assert(meta1.attemptId === attemptA, "attemptId persistido");

    const second = await tryAcquireInboundDeliverySendRight(inbound.id, key, prisma);
    assert(second.status === "in_progress", "segundo acquire bloqueado");

    const providerId = "wamid.pg.outbound.1";
    const accepted = await recordInboundWaProviderAccepted(
      inbound.id,
      key,
      attemptA,
      providerId,
      prisma,
    );
    assert(accepted, "record provider accepted con attemptId");

    const wrongRelease = await releaseInboundDeliverySendRight(
      inbound.id,
      key,
      "wrong-attempt-id",
      prisma,
    );
    assert(!wrongRelease, "release con attemptId incorrecto no-op");

    const marked = await markInboundDeliveryDelivered(
      inbound.id,
      key,
      providerId,
      attemptA,
      prisma,
    );
    assert(marked, "mark delivered con attemptId correcto");

    const row2 = await prisma.ticketMessage.findUnique({
      where: { id: inbound.id },
      select: { rawPayload: true },
    });
    const meta2 = readMeta(row2?.rawPayload);
    assert(meta2.waDeliveryState === "delivered", "estado delivered en PG");
    assert(meta2.waOutboundProviderId === providerId, "provider id en JSONB");

    console.log("\n— Carrera PG: A stale, B reclama, A no libera —");
    const inbound2 = await prisma.ticketMessage.create({
      data: {
        ticketId: ticket.id,
        direction: "INBOUND",
        from: "CUSTOMER",
        text: "Odometro pg race",
        externalMessageId: `${TEST_WAMID}.race`,
        rawPayload: { source: "pg_test_race" },
      },
    });
    const key2 = inboundDeliveryKeyFromParts({ turnMessageId: inbound2.externalMessageId });
    const a = await tryAcquireInboundDeliverySendRight(inbound2.id, key2, prisma);
    assert(a.status === "acquired", "A adquiere");
    const attemptOld = a.status === "acquired" ? a.attemptId : "";

    await prisma.$executeRawUnsafe(
      `UPDATE "TicketMessage"
       SET "rawPayload" = jsonb_set(
         "rawPayload",
         '{waTurnDelivery,sendInitiatedAt}',
         to_jsonb($1::bigint)
       )
       WHERE id = $2`,
      Date.now() - SEND_INITIATED_STALE_MS - 5000,
      inbound2.id,
    );

    const b = await tryAcquireInboundDeliverySendRight(inbound2.id, key2, prisma);
    assert(b.status === "acquired", "B reclama tras stale");
    const attemptNew = b.status === "acquired" ? b.attemptId : "";
    assert(attemptNew !== attemptOld, "attemptId distinto");

    const late = await releaseInboundDeliverySendRight(
      inbound2.id,
      key2,
      attemptOld,
      prisma,
    );
    assert(!late, "A no libera reserva de B");

    const rowRace = await prisma.ticketMessage.findUnique({
      where: { id: inbound2.id },
      select: { rawPayload: true },
    });
    const metaRace = readMeta(rowRace?.rawPayload);
    assert(metaRace.attemptId === attemptNew, "reserva activa es de B");
  } finally {
    await prisma.ticketMessage.deleteMany({ where: { ticketId: ticket.id } });
    await prisma.ticket.delete({ where: { id: ticket.id } });
    await prisma.customer.delete({ where: { id: customer.id } });
    await prisma.$disconnect();
  }

  if (failures > 0) {
    console.error(`\n✗ ${failures} fallo(s) en verify-turn-delivery-ledger-pg`);
    process.exit(1);
  }
  console.log("\n✓ verify-turn-delivery-ledger-pg OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
