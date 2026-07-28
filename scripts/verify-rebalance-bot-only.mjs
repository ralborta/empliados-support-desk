#!/usr/bin/env node
/**
 * Regresión bug real 2026-07-28 (reclamo cliente vía WhatsApp, ~11:49am):
 * "Continua derivandome al asesor online casos que no requieren atencion por asesor humano".
 *
 * El fix previo de la lista blanca (shouldAutoAssignInboundMessage) solo corría dentro del
 * webhook de WhatsApp entrante. Pero `rebalanceAmongActiveAdvisors` — que se dispara cada vez
 * que un asesor se conecta o manda heartbeat — barría CUALQUIER ticket abierto sin asignar sin
 * mirar de qué se trataba, así que una consulta de GPS ya resuelta por el bot (ej. "Necesito
 * consultar por reporte... AB 000 MW" → detenida/ignición apagada, normal) terminaba igual en
 * la bandeja del asesor 30-60s después, sin ningún mensaje nuevo del cliente.
 *
 * Evidencia real en producción: tickets 28072612 y 28072611 (2026-07-28), ambos con
 * incidentType "OTHER" (ese campo se pisa en cada mensaje, no es una marca estable), asignados
 * vía evento ASSIGNED source=advisor_distribution decenas de segundos/minutos DESPUÉS del
 * último mensaje del cliente — consistente con el sweep de reconexión, no con el webhook.
 *
 * Esta suite prueba `isUnassignedWhatsappTicketBotResolved` (usada por
 * rebalanceAmongActiveAdvisors para filtrar el pool) contra la DB real, con un ticket/cliente
 * descartable — NO llama a rebalanceAmongActiveAdvisors() completo (evitaría reasignar tickets
 * reales de producción).
 *
 * Requiere DATABASE_URL.
 */
import { PrismaClient } from "@prisma/client";
import { isUnassignedWhatsappTicketBotResolved } from "../src/lib/advisorDistribution.ts";

const prisma = new PrismaClient();
const TEST_PHONE = "5490000000777";

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
  const tickets = await prisma.ticket.findMany({ where: { customerId: existing.id }, select: { id: true } });
  const ticketIds = tickets.map((t) => t.id);
  if (ticketIds.length) {
    await prisma.ticketMessage.deleteMany({ where: { ticketId: { in: ticketIds } } });
    await prisma.ticketEvent.deleteMany({ where: { ticketId: { in: ticketIds } } });
    await prisma.ticket.deleteMany({ where: { id: { in: ticketIds } } });
  }
  await prisma.customer.deleteMany({ where: { phone: TEST_PHONE } });
}

async function makeTicket(channel) {
  const customer = await prisma.customer.upsert({
    where: { phone: TEST_PHONE },
    create: { phone: TEST_PHONE, name: "Test Rebalance", companyName: "El Cacique S.A." },
    update: {},
  });
  const ticket = await prisma.ticket.create({
    data: {
      code: `TEST${Date.now()}${Math.floor(Math.random() * 1000)}`,
      customerId: customer.id,
      contactName: "Test Rebalance",
      title: "Consulta de prueba",
      status: "OPEN",
      priority: "NORMAL",
      category: "TECH_SUPPORT",
      channel,
    },
  });
  return ticket;
}

async function setLastInbound(ticketId, text) {
  await prisma.ticketMessage.create({
    data: { ticketId, direction: "INBOUND", from: "CUSTOMER", text, rawPayload: {} },
  });
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.log("SKIP: falta DATABASE_URL (correr con .env.local o CI)");
    return;
  }

  console.log("— rebalanceAmongActiveAdvisors no debe barrer tickets que Atilio resolvió solo (DB real) —");

  await purgeTestCustomer();
  try {
    console.log("\n— Caso real: consulta GPS resuelta (ticket 28072612, AB 000 MW) —");
    let ticket = await makeTicket("WHATSAPP");
    await setLastInbound(ticket.id, "Necesito consultar por reporte de una de mis unidades.\nEs la AB 000 MW");
    assert(
      (await isUnassignedWhatsappTicketBotResolved(ticket.id, "WHATSAPP")) === true,
      "consulta GPS normal (sin patrón de incidente) → bot-resuelto, no derivar",
    );

    console.log("\n— Falta de reporte real → sí debe poder derivarse —");
    ticket = await makeTicket("WHATSAPP");
    await setLastInbound(ticket.id, "la unidad no me reporta desde ayer");
    assert(
      (await isUnassignedWhatsappTicketBotResolved(ticket.id, "WHATSAPP")) === false,
      "falta de reporte → elegible para el pool de asesores",
    );

    console.log("\n— Pedido explícito de humano → sí debe poder derivarse —");
    ticket = await makeTicket("WHATSAPP");
    await setLastInbound(ticket.id, "quiero hablar con un asesor humano por favor");
    assert(
      (await isUnassignedWhatsappTicketBotResolved(ticket.id, "WHATSAPP")) === false,
      "pedido explícito de asesor → elegible para el pool",
    );

    console.log("\n— Saludo / charla bot-only → no debe derivarse —");
    ticket = await makeTicket("WHATSAPP");
    await setLastInbound(ticket.id, "hola, buenas tardes");
    assert(
      (await isUnassignedWhatsappTicketBotResolved(ticket.id, "WHATSAPP")) === true,
      "saludo → bot-resuelto, no derivar",
    );

    console.log("\n— Sin mensajes inbound todavía → no bloquea (no hay señal para excluir) —");
    ticket = await makeTicket("WHATSAPP");
    assert(
      (await isUnassignedWhatsappTicketBotResolved(ticket.id, "WHATSAPP")) === false,
      "ticket WhatsApp sin mensajes → elegible por defecto",
    );

    console.log("\n— Canales no-WhatsApp (panel/email/web) no se ven afectados por este filtro —");
    ticket = await makeTicket("WEB");
    await setLastInbound(ticket.id, "Necesito consultar por reporte de una de mis unidades.\nEs la AB 000 MW");
    assert(
      (await isUnassignedWhatsappTicketBotResolved(ticket.id, "WEB")) === false,
      "canal WEB → nunca se excluye por este filtro (sigue como antes)",
    );

    console.log("\n— Admin des-asignó a mano (botón \"Sin asignar\") → siempre vuelve a la cola —");
    ticket = await makeTicket("WHATSAPP");
    await setLastInbound(ticket.id, "Necesito consultar por reporte de una de mis unidades.\nEs la AB 000 MW");
    await prisma.ticketEvent.create({
      data: {
        ticketId: ticket.id,
        type: "ASSIGNED",
        payload: { assignedToUserId: null, previousAssignedToUserId: "fake-agent-id", source: "admin_manual" },
      },
    });
    assert(
      (await isUnassignedWhatsappTicketBotResolved(ticket.id, "WHATSAPP")) === false,
      "ticket ya tocado por un humano (evento ASSIGNED previo) → no se excluye aunque el último mensaje parezca bot-only",
    );
  } finally {
    await purgeTestCustomer();
    await prisma.$disconnect();
  }

  if (failures > 0) {
    console.error(`\n✗ ${failures} fallo(s) en verify-rebalance-bot-only`);
    process.exit(1);
  }
  console.log("\n✓ Regresión rebalanceAmongActiveAdvisors / bot-only OK (DB real)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
