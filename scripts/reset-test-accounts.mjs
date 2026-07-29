#!/usr/bin/env node
/**
 * Reinicia por completo el estado de las cuentas de PRUEBA usadas para testear el bot
 * (nombre "Raúl A." y "Administrador Wara") — NO toca clientes reales.
 * Borra: TicketMessage, TicketEvent, TicketTag, AgentNotification, Ticket, y limpia en
 * el Customer: pendingAction, activeUnit, selectedCompanyContactId, waraSessionToken,
 * waraSessionAt, licensePlate, botPausedAt, companyName.
 *
 * Uso: node scripts/reset-test-accounts.mjs [--dry-run]
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

function loadEnvFile(file) {
  if (!existsSync(file)) return;
  const text = readFileSync(file, "utf8");
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}
loadEnvFile(path.join(process.cwd(), ".env.production.local"));

const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();

const dryRun = process.argv.includes("--dry-run");

const TEST_PHONES = [
  "5491133788190", // Raúl A.
  "5492613330288", // Administrador Wara
  "5492614696353", // Administrador Wara
];

const customers = await prisma.customer.findMany({
  where: { phone: { in: TEST_PHONES } },
});

console.log(`Cuentas de prueba encontradas: ${customers.length}\n`);
for (const c of customers) {
  console.log(`- ${c.name ?? "(sin nombre)"} — ${c.phone} — id: ${c.id}`);
}
console.log("");

if (dryRun) {
  for (const c of customers) {
    const tickets = await prisma.ticket.findMany({ where: { customerId: c.id }, select: { id: true } });
    const ticketIds = tickets.map((t) => t.id);
    const msgCount = ticketIds.length ? await prisma.ticketMessage.count({ where: { ticketId: { in: ticketIds } } }) : 0;
    console.log(`[DRY-RUN] ${c.phone}: ${tickets.length} tickets, ${msgCount} mensajes se borrarían.`);
  }
  await prisma.$disconnect();
  process.exit(0);
}

for (const c of customers) {
  const tickets = await prisma.ticket.findMany({ where: { customerId: c.id }, select: { id: true } });
  const ticketIds = tickets.map((t) => t.id);

  if (ticketIds.length) {
    const notif = await prisma.agentNotification.deleteMany({ where: { ticketId: { in: ticketIds } } });
    const msgs = await prisma.ticketMessage.deleteMany({ where: { ticketId: { in: ticketIds } } });
    const events = await prisma.ticketEvent.deleteMany({ where: { ticketId: { in: ticketIds } } });
    const tags = await prisma.ticketTag.deleteMany({ where: { ticketId: { in: ticketIds } } });
    const tix = await prisma.ticket.deleteMany({ where: { id: { in: ticketIds } } });
    console.log(
      `${c.phone}: borrados ${tix.count} tickets, ${msgs.count} mensajes, ${events.count} eventos, ${tags.count} tags, ${notif.count} notificaciones.`,
    );
  } else {
    console.log(`${c.phone}: sin tickets previos.`);
  }

  await prisma.customer.update({
    where: { id: c.id },
    data: {
      pendingAction: null,
      activeUnit: null,
      selectedCompanyContactId: null,
      waraSessionToken: null,
      waraSessionAt: null,
      licensePlate: null,
      botPausedAt: null,
      companyName: null,
    },
  });
  console.log(`${c.phone}: estado (pendingAction/activeUnit/empresa/sesión) limpiado.\n`);
}

console.log("Listo. Las cuentas de prueba quedaron con historial vacío y estado en blanco.");
await prisma.$disconnect();
