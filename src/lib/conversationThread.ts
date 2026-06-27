import { prisma } from "@/lib/db";
import { findCustomerByWhatsAppNumber } from "@/lib/whatsappPhone";

function normTurnText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

/**
 * BuilderBot puede volver a ejecutar Inicio→Router con el mismo mensaje del cliente
 * después de un subflujo informativo. Si ya hubo respuesta del bot, ignorar el re-proceso.
 */
export async function shouldIgnoreDuplicateInicioTurn(
  rawPhone: string,
  selectionText: string,
  windowMs = 3 * 60 * 1000
): Promise<boolean> {
  const text = selectionText.trim();
  if (!text) return false;

  const customer = await findCustomerByWhatsAppNumber(prisma, rawPhone);
  if (!customer) return false;

  const since = new Date(Date.now() - windowMs);
  const lastInbound = await prisma.ticketMessage.findFirst({
    where: {
      ticket: { customerId: customer.id },
      direction: "INBOUND",
      createdAt: { gte: since },
    },
    orderBy: { createdAt: "desc" },
  });
  if (!lastInbound?.text) return false;
  if (normTurnText(lastInbound.text) !== normTurnText(text)) return false;

  const botReplies = await prisma.ticketMessage.count({
    where: {
      ticketId: lastInbound.ticketId,
      direction: "OUTBOUND",
      createdAt: { gt: lastInbound.createdAt, gte: since },
    },
  });
  return botReplies > 0;
}

/** Texto reciente del ticket del cliente (mensajes persistidos en el panel). */
export async function recentLastInboundTextForPhone(
  rawPhone: string,
  windowMs = 15 * 60 * 1000
): Promise<string> {
  try {
    const customer = await findCustomerByWhatsAppNumber(prisma, rawPhone);
    if (!customer) return "";
    const since = new Date(Date.now() - windowMs);
    const msg = await prisma.ticketMessage.findFirst({
      where: {
        ticket: { customerId: customer.id },
        direction: "INBOUND",
        createdAt: { gte: since },
      },
      orderBy: { createdAt: "desc" },
      select: { text: true },
    });
    return msg?.text?.trim() ?? "";
  } catch {
    return "";
  }
}

/** Texto reciente del ticket del cliente (mensajes persistidos en el panel). */
export async function recentThreadTextForPhone(rawPhone: string, take = 24): Promise<string> {
  try {
    const customer = await findCustomerByWhatsAppNumber(prisma, rawPhone);
    if (!customer) return "";
    const ticket = await prisma.ticket.findFirst({
      where: { customerId: customer.id },
      orderBy: { lastMessageAt: "desc" },
    });
    if (!ticket) return "";
    const msgs = await prisma.ticketMessage.findMany({
      where: { ticketId: ticket.id },
      orderBy: { createdAt: "desc" },
      take,
      select: { text: true },
    });
    return msgs
      .reverse()
      .map((m) => m.text)
      .filter(Boolean)
      .join("\n");
  } catch {
    return "";
  }
}
