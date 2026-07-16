#!/usr/bin/env node
/**
 * Borra todos los casos (tickets) y mensajes del panel.
 * Conserva clientes, agentes, prompts y tags (sin vínculos).
 *
 * Uso:
 *   DATABASE_URL=... node scripts/purge-tickets-and-messages.mjs          # dry-run
 *   DATABASE_URL=... node scripts/purge-tickets-and-messages.mjs --confirm
 */
import { PrismaClient } from "@prisma/client";

const confirm = process.argv.includes("--confirm");

const prisma = new PrismaClient();

async function countAll() {
  const [tickets, messages, events, tags, notifications] = await Promise.all([
    prisma.ticket.count(),
    prisma.ticketMessage.count(),
    prisma.ticketEvent.count(),
    prisma.ticketTag.count(),
    prisma.agentNotification.count(),
  ]);
  return { tickets, messages, events, tags, notifications };
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("Falta DATABASE_URL");
    process.exit(1);
  }

  const before = await countAll();
  console.log("Estado actual:");
  console.log(`  Tickets:              ${before.tickets}`);
  console.log(`  Mensajes:             ${before.messages}`);
  console.log(`  Eventos de ticket:    ${before.events}`);
  console.log(`  TicketTag (vínculos): ${before.tags}`);
  console.log(`  Notificaciones:       ${before.notifications}`);

  if (before.tickets === 0 && before.messages === 0) {
    console.log("\nNada que borrar.");
    return;
  }

  if (!confirm) {
    console.log("\nDry-run. Para ejecutar: agregá --confirm");
    return;
  }

  console.log("\nBorrando en transacción…");

  const deleted = await prisma.$transaction(
    async (tx) => {
      const notifications = await tx.agentNotification.deleteMany();
      const messages = await tx.ticketMessage.deleteMany();
      const events = await tx.ticketEvent.deleteMany();
      const ticketTags = await tx.ticketTag.deleteMany();
      const tickets = await tx.ticket.deleteMany();
      return { notifications, messages, events, ticketTags, tickets };
    },
    { timeout: 300_000 },
  );

  console.log("Eliminado:");
  console.log(`  Notificaciones: ${deleted.notifications.count}`);
  console.log(`  Mensajes:       ${deleted.messages.count}`);
  console.log(`  Eventos:        ${deleted.events.count}`);
  console.log(`  TicketTag:      ${deleted.ticketTags.count}`);
  console.log(`  Tickets:        ${deleted.tickets.count}`);

  const after = await countAll();
  console.log("\nEstado final:");
  console.log(`  Tickets:   ${after.tickets}`);
  console.log(`  Mensajes:  ${after.messages}`);

  const [customers, agents] = await Promise.all([
    prisma.customer.count(),
    prisma.agentUser.count(),
  ]);
  console.log(`\nConservado: ${customers} clientes, ${agents} agentes.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
