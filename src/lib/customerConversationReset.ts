import type { PrismaClient } from "@prisma/client";
import { findCustomerByWhatsAppNumber } from "@/lib/whatsappPhone";

export type ClearCustomerTicketHistoryResult = {
  customerId: string | null;
  ticketsDeleted: number;
  messagesDeleted: number;
};

/**
 * Borra todos los tickets y mensajes del cliente (panel + hilo del router).
 * Conserva el registro Customer (teléfono, nombre); no toca Odoo.
 */
export async function clearCustomerTicketHistory(
  prisma: PrismaClient,
  rawPhone: string
): Promise<ClearCustomerTicketHistoryResult> {
  const customer = await findCustomerByWhatsAppNumber(prisma, rawPhone);
  if (!customer) {
    return { customerId: null, ticketsDeleted: 0, messagesDeleted: 0 };
  }

  const tickets = await prisma.ticket.findMany({
    where: { customerId: customer.id },
    select: { id: true },
  });
  const ticketIds = tickets.map((t) => t.id);
  if (ticketIds.length === 0) {
    return { customerId: customer.id, ticketsDeleted: 0, messagesDeleted: 0 };
  }

  const result = await prisma.$transaction(async (tx) => {
    const messages = await tx.ticketMessage.deleteMany({ where: { ticketId: { in: ticketIds } } });
    await tx.ticketEvent.deleteMany({ where: { ticketId: { in: ticketIds } } });
    await tx.ticketTag.deleteMany({ where: { ticketId: { in: ticketIds } } });
    await tx.agentNotification.deleteMany({ where: { ticketId: { in: ticketIds } } });
    const ticketsDeleted = await tx.ticket.deleteMany({ where: { customerId: customer.id } });
    return { messagesDeleted: messages.count, ticketsDeleted: ticketsDeleted.count };
  });

  console.log(
    `[customerReset] ${rawPhone}: ${result.ticketsDeleted} ticket(s), ${result.messagesDeleted} mensaje(s) eliminados`
  );

  return {
    customerId: customer.id,
    ticketsDeleted: result.ticketsDeleted,
    messagesDeleted: result.messagesDeleted,
  };
}
