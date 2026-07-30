import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import { looksLikeCustomerConversationCloseRequest } from "@/lib/customerConversationClose";
import {
  buildCaseRegisteredWithoutOdooRefReply,
  findCustomerVisibleOdooCaseRef,
  formatCustomerOdooCaseRefForWhatsApp,
} from "@/lib/customerOdooCaseRef";
import { OPEN_TICKET_THREAD_STATUSES } from "@/lib/ticketThreading";
import { findCustomerByWhatsAppNumber } from "@/lib/whatsappPhone";

/** Persiste respuesta del bot en el ticket del cliente (panel / historial). */
export async function persistCustomerBotReply(
  rawPhone: string,
  text: string,
  payload: Record<string, unknown>,
  client: PrismaClient = prisma,
): Promise<void> {
  const message = text?.trim();
  if (!message) return;
  const customer = await findCustomerByWhatsAppNumber(client, rawPhone);
  if (!customer) return;
  const targetTicket =
    (await client.ticket.findFirst({
      where: { customerId: customer.id, status: { in: OPEN_TICKET_THREAD_STATUSES } },
      orderBy: { lastMessageAt: "desc" },
    })) ??
    (await client.ticket.findFirst({
      where: { customerId: customer.id },
      orderBy: { lastMessageAt: "desc" },
    }));
  if (!targetTicket) return;
  const recent = await client.ticketMessage.findFirst({
    where: {
      ticketId: targetTicket.id,
      direction: "OUTBOUND",
      from: "BOT",
      text: message,
      createdAt: { gte: new Date(Date.now() - 2 * 60 * 1000) },
    },
  });
  if (recent) return;
  await client.ticketMessage.create({
    data: {
      ticketId: targetTicket.id,
      direction: "OUTBOUND",
      from: "BOT",
      text: message,
      rawPayload: payload as never,
    },
  });
}

/** Persiste mensaje entrante del cliente (panel / hilo de clasificación). */
export async function persistCustomerInbound(
  rawPhone: string,
  text: string,
  payload: Record<string, unknown>,
  client: PrismaClient = prisma,
): Promise<void> {
  const message = text?.trim();
  if (!message) return;
  const customer = await findCustomerByWhatsAppNumber(client, rawPhone);
  if (!customer) return;
  const targetTicket =
    (await client.ticket.findFirst({
      where: { customerId: customer.id, status: { in: OPEN_TICKET_THREAD_STATUSES } },
      orderBy: { lastMessageAt: "desc" },
    })) ??
    (await client.ticket.findFirst({
      where: { customerId: customer.id },
      orderBy: { lastMessageAt: "desc" },
    }));
  if (!targetTicket) return;
  const recent = await client.ticketMessage.findFirst({
    where: {
      ticketId: targetTicket.id,
      direction: "INBOUND",
      from: "CUSTOMER",
      text: message,
      createdAt: { gte: new Date(Date.now() - 2 * 60 * 1000) },
    },
  });
  if (recent) return;
  await client.ticketMessage.create({
    data: {
      ticketId: targetTicket.id,
      direction: "INBOUND",
      from: "CUSTOMER",
      text: message,
      rawPayload: payload as never,
    },
  });
  await client.ticket.update({
    where: { id: targetTicket.id },
    data: { lastMessageAt: new Date() },
  });
}

function normInquiryText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Cliente pregunta si tiene un caso/ticket abierto (no pide asesor ni patente). */
export function looksLikeOpenCaseStatusInquiry(text: string | undefined | null): boolean {
  const t = normInquiryText(text ?? "");
  if (!t || t.length > 160) return false;

  if (looksLikeCustomerConversationCloseRequest(text)) return false;

  return (
    /\b(tengo|hay|tiene|tienen|existe)\s+(un\s+)?(caso|ticket|reclamo|consulta)\s+(abierto|activo|pendiente|en curso)\b/.test(
      t,
    ) ||
    /\b(caso|ticket|reclamo|consulta)\s+(abierto|activo|pendiente|en curso)\b/.test(t) ||
    /\btengo\s+algo\s+(abierto|pendiente|en curso)\b/.test(t) ||
    /\b(cual|cu[aá]l)\s+es\s+(mi|el)\s+(caso|ticket|reclamo)\s+(abierto|activo)\b/.test(t)
  );
}

export async function buildOpenCaseStatusReply(
  rawPhone: string,
  client: PrismaClient = prisma,
): Promise<string> {
  const customer = await findCustomerByWhatsAppNumber(client, rawPhone);
  if (!customer) {
    return "No pude identificar tu número. Si necesitás ayuda, escribime de nuevo.";
  }

  const openTicket = await client.ticket.findFirst({
    where: {
      customerId: customer.id,
      status: { in: OPEN_TICKET_THREAD_STATUSES },
    },
    orderBy: { lastMessageAt: "desc" },
    select: { id: true },
  });

  if (openTicket) {
    const odooRef = await findCustomerVisibleOdooCaseRef(client, {
      customerId: customer.id,
      ticketId: openTicket.id,
    });
    if (odooRef) {
      const display = formatCustomerOdooCaseRefForWhatsApp(odooRef);
      return `Sí, tenés el caso *${display}* abierto. Puedo seguir ayudándote por este chat con consultas sobre ese tema o cosas nuevas. Si querés cerrarlo, escribí "cerrar caso" o "resolver conversación".`;
    }
    return "Sí, tenés un caso abierto en Atención al cliente. Puedo seguir ayudándote por este chat. Si querés cerrarlo, escribí \"cerrar caso\" o \"resolver conversación\".";
  }

  const lastClosed = await client.ticket.findFirst({
    where: {
      customerId: customer.id,
      status: { in: ["RESOLVED", "CLOSED"] },
    },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });

  if (lastClosed) {
    const odooRef = await findCustomerVisibleOdooCaseRef(client, {
      customerId: customer.id,
      ticketId: lastClosed.id,
    });
    if (odooRef) {
      const display = formatCustomerOdooCaseRefForWhatsApp(odooRef);
      return `No tenés casos abiertos. El último (*${display}*) ya está cerrado. ¿En qué te puedo ayudar?`;
    }
    return "No tenés casos abiertos. ¿En qué te puedo ayudar?";
  }

  return "No tenés casos registrados con este número. Contame en qué te puedo ayudar.";
}
