import type { Prisma, PrismaClient } from "@prisma/client";
import { allocateTicketCode } from "@/lib/tickets";
import { findCustomerByWhatsAppNumber } from "@/lib/whatsappPhone";

export type ClearCustomerTicketHistoryResult = {
  customerId: string | null;
  ticketsDeleted: number;
  messagesDeleted: number;
  preservedInbounds?: number;
};

export type ClearCustomerTicketHistoryOptions = {
  /**
   * Conserva inbound recientes (p.ej. el wamid del turno actual) para que el
   * delivery guard de teléfonos protegidos no silencie la respuesta del reset.
   */
  preserveInboundSince?: Date;
};

type PreservedInbound = {
  text: string;
  attachments: Prisma.InputJsonValue | undefined;
  rawPayload: Prisma.InputJsonValue;
  externalMessageId: string | null;
  createdAt: Date;
};

/**
 * Borra todos los tickets y mensajes del cliente (panel + hilo del router).
 * Conserva el registro Customer (teléfono, nombre); no toca Odoo.
 */
export async function clearCustomerTicketHistory(
  prisma: PrismaClient,
  rawPhone: string,
  opts?: ClearCustomerTicketHistoryOptions,
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

  let preserved: PreservedInbound[] = [];
  if (opts?.preserveInboundSince) {
    const rows = await prisma.ticketMessage.findMany({
      where: {
        ticketId: { in: ticketIds },
        direction: "INBOUND",
        from: "CUSTOMER",
        createdAt: { gte: opts.preserveInboundSince },
      },
      orderBy: { createdAt: "asc" },
      take: 20,
      select: {
        text: true,
        attachments: true,
        rawPayload: true,
        externalMessageId: true,
        createdAt: true,
      },
    });
    preserved = rows.map((r) => ({
      text: r.text,
      attachments: (r.attachments as Prisma.InputJsonValue | null) ?? undefined,
      rawPayload: r.rawPayload as Prisma.InputJsonValue,
      externalMessageId: r.externalMessageId,
      createdAt: r.createdAt,
    }));
  }

  const result = await prisma.$transaction(async (tx) => {
    const messages = await tx.ticketMessage.deleteMany({ where: { ticketId: { in: ticketIds } } });
    await tx.ticketEvent.deleteMany({ where: { ticketId: { in: ticketIds } } });
    await tx.ticketTag.deleteMany({ where: { ticketId: { in: ticketIds } } });
    await tx.agentNotification.deleteMany({ where: { ticketId: { in: ticketIds } } });
    const ticketsDeleted = await tx.ticket.deleteMany({ where: { customerId: customer.id } });

    let preservedInbounds = 0;
    if (preserved.length > 0) {
      const code = await allocateTicketCode(tx);
      const ticket = await tx.ticket.create({
        data: {
          code,
          customerId: customer.id,
          contactName: customer.name || "WhatsApp",
          title: "Conversación WhatsApp",
          status: "OPEN",
          priority: "NORMAL",
          category: "OTHER",
          channel: "WHATSAPP",
          lastMessageAt: preserved[preserved.length - 1]!.createdAt,
        },
      });
      for (const m of preserved) {
        // externalMessageId es unique: reinsertar el mismo wamid tras el delete.
        await tx.ticketMessage.create({
          data: {
            ticketId: ticket.id,
            direction: "INBOUND",
            from: "CUSTOMER",
            text: m.text,
            attachments: m.attachments,
            rawPayload: m.rawPayload,
            externalMessageId: m.externalMessageId,
            createdAt: m.createdAt,
          },
        });
        preservedInbounds += 1;
      }
    }

    return {
      messagesDeleted: messages.count,
      ticketsDeleted: ticketsDeleted.count,
      preservedInbounds,
    };
  });

  console.log(
    `[customerReset] ${rawPhone}: ${result.ticketsDeleted} ticket(s), ${result.messagesDeleted} mensaje(s) eliminados` +
      (result.preservedInbounds
        ? `, ${result.preservedInbounds} inbound preservado(s)`
        : ""),
  );

  return {
    customerId: customer.id,
    ticketsDeleted: result.ticketsDeleted,
    messagesDeleted: result.messagesDeleted,
    preservedInbounds: result.preservedInbounds,
  };
}
