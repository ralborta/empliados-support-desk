#!/usr/bin/env node
/**
 * Regresión: "Reiniciar empresa" debe dejar el hilo en cero (tickets + mensajes +
 * pendingAction + activeUnit + sesión Wara).
 *
 * Usa un teléfono ficticio y DB real (mismo patrón que verify-pending-action-state).
 * Requiere DATABASE_URL.
 */
import { PrismaClient } from "@prisma/client";
import { clearCustomerTicketHistory } from "../src/lib/customerConversationReset.ts";
import { clearActiveUnit, setActiveUnit } from "../src/lib/activeUnit.ts";
import { clearPendingAction, setPendingAction } from "../src/lib/pendingAction.ts";
import { recentThreadTextForPhone } from "../src/lib/conversationThread.ts";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const prisma = new PrismaClient();
const TEST_PHONE = "5490000000888";

let failures = 0;
function assert(cond, label) {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}

async function purgeTestCustomer() {
  const existing = await prisma.customer.findUnique({ where: { phone: TEST_PHONE } });
  if (!existing) return;
  await clearCustomerTicketHistory(prisma, TEST_PHONE);
  await prisma.customer.deleteMany({ where: { phone: TEST_PHONE } });
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.log("SKIP: falta DATABASE_URL (correr con .env.local o CI)");
    return;
  }

  console.log("— Reset de conversación (DB real, teléfono de prueba) —");

  await purgeTestCustomer();
  const customer = await prisma.customer.create({
    data: {
      phone: TEST_PHONE,
      name: "Test Reset",
      companyName: "El Cacique S.A.",
      selectedCompanyContactId: 99,
      waraSessionToken: "fake-token",
      waraSessionAt: new Date(),
    },
  });

  const code = `TEST${Date.now()}`;
  const ticket = await prisma.ticket.create({
    data: {
      code,
      customerId: customer.id,
      contactName: "Test Reset",
      title: "Consulta vieja",
      status: "IN_PROGRESS",
      priority: "NORMAL",
      category: "TECH_SUPPORT",
      channel: "WHATSAPP",
    },
  });

  await prisma.ticketMessage.createMany({
    data: [
      {
        ticketId: ticket.id,
        direction: "INBOUND",
        from: "CUSTOMER",
        text: "horometro de AF061DO",
        rawPayload: {},
      },
      {
        ticketId: ticket.id,
        direction: "OUTBOUND",
        from: "BOT",
        text: "Seguimos con el cambio de odómetro",
        rawPayload: {},
      },
    ],
  });

  await setPendingAction(prisma, TEST_PHONE, "odometro", {
    summary: "pendiente viejo",
    payload: { patente: "AF061DO" },
  });
  await setActiveUnit(prisma, TEST_PHONE, "AF061DO", { label: "M600-012" });

  const threadBefore = await recentThreadTextForPhone(TEST_PHONE);
  assert(threadBefore.includes("horometro"), "hilo contaminado antes del reset");

  const cleared = await clearCustomerTicketHistory(prisma, TEST_PHONE);
  assert(cleared.ticketsDeleted === 1, "borra 1 ticket");
  assert(cleared.messagesDeleted === 2, "borra 2 mensajes");

  await clearPendingAction(prisma, TEST_PHONE);
  await clearActiveUnit(prisma, TEST_PHONE);
  await prisma.customer.update({
    where: { id: customer.id },
    data: {
      companyName: "",
      selectedCompanyContactId: null,
      waraSessionToken: null,
      waraSessionAt: null,
    },
  });

  const ticketsLeft = await prisma.ticket.count({ where: { customerId: customer.id } });
  const msgsLeft = await prisma.ticketMessage.count({ where: { ticketId: ticket.id } });
  const threadAfter = await recentThreadTextForPhone(TEST_PHONE);
  const pending = await prisma.customer.findUnique({
    where: { phone: TEST_PHONE },
    select: { pendingAction: true, activeUnit: true, companyName: true, waraSessionToken: true },
  });

  assert(ticketsLeft === 0, "sin tickets tras reset");
  assert(msgsLeft === 0, "sin mensajes tras reset");
  assert(threadAfter === "", "recentThreadTextForPhone vacío tras reset");
  assert(pending?.pendingAction === null, "pendingAction limpio");
  assert(pending?.activeUnit === null, "activeUnit limpio");
  assert(pending?.companyName === "", "companyName vacío");
  assert(pending?.waraSessionToken === null, "sesión Wara limpia");

  const waraApiSrc = fs.readFileSync(path.join(__dirname, "../src/lib/waraApi.ts"), "utf8");
  assert(
    waraApiSrc.includes("clearCustomerTicketHistory"),
    "resetCustomerCompanyMenu integra clearCustomerTicketHistory",
  );

  await purgeTestCustomer();
  await prisma.$disconnect();

  if (failures > 0) {
    console.error(`\n✗ ${failures} fallo(s) en verify-customer-conversation-reset`);
    process.exit(1);
  }
  console.log("\n✓ Reset de conversación OK (DB real)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
