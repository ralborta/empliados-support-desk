import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import { sendWhatsAppMessage } from "@/lib/builderbot";
import { OPEN_TICKET_THREAD_STATUSES } from "@/lib/ticketThreading";
import { findCustomerByWhatsAppNumber } from "@/lib/whatsappPhone";

function normCloseText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * El cliente pide cerrar/resolver la conversación o el caso (no "resolver un problema técnico").
 */
export function looksLikeCustomerConversationCloseRequest(text: string | undefined | null): boolean {
  const t = normCloseText(text ?? "");
  if (!t || t.length > 140) return false;

  if (
    /^(cerrar|resolver|finalizar|terminar)\s+(la\s+)?(conversacion|charla|chat|caso|ticket|consulta|reclamo)\b/.test(
      t,
    )
  ) {
    return true;
  }

  if (/^(cerrar|resolver|finalizar)\s+(caso|ticket|consulta|reclamo)\b/.test(t)) {
    return true;
  }

  if (/\bcerr(a|ame|ar)\s+(la\s+)?(conversacion|charla|chat|caso|ticket|consulta|reclamo)\b/.test(t)) {
    return true;
  }

  if (/\b(cerrame|cerráme)\s+(el\s+)?(caso|ticket|consulta|reclamo|conversacion|charla)\b/.test(t)) {
    return true;
  }

  if (/\b(dar por cerrad[oa]|dar por resuelt[oa]|dalo por cerrado)\b/.test(t)) {
    return true;
  }

  return false;
}

export type CustomerConversationCloseResult = {
  handled: boolean;
  closed: boolean;
  ticketCode: string | null;
  ticketId: string | null;
  replyMessage: string;
};

/**
 * Cierra el ticket abierto del cliente cuando pide explícitamente cerrar/resolver la conversación.
 * Conserva el historial de mensajes (no borra como close-by-ai).
 */
export async function handleCustomerConversationCloseRequest(params: {
  rawPhone: string;
  messageText: string;
  contactName?: string;
  externalMessageId?: string;
  source?: string;
  client?: PrismaClient;
}): Promise<CustomerConversationCloseResult> {
  const db = params.client ?? prisma;
  const customer = await findCustomerByWhatsAppNumber(db, params.rawPhone);
  if (!customer) {
    return {
      handled: true,
      closed: false,
      ticketCode: null,
      ticketId: null,
      replyMessage:
        "No pude identificar tu número para cerrar el caso. Si necesitás ayuda, escribime de nuevo.",
    };
  }

  const openTicket = await db.ticket.findFirst({
    where: {
      customerId: customer.id,
      status: { in: OPEN_TICKET_THREAD_STATUSES },
    },
    orderBy: { lastMessageAt: "desc" },
  });

  if (!openTicket) {
    const lastClosed = await db.ticket.findFirst({
      where: {
        customerId: customer.id,
        status: { in: ["RESOLVED", "CLOSED"] },
      },
      orderBy: { updatedAt: "desc" },
    });

    if (lastClosed) {
      const replyMessage = `Tu caso *${lastClosed.code}* ya estaba cerrado. Si necesitás algo más, escribime y abrimos una nueva consulta.`;
      await sendCloseReply({
        ticketId: lastClosed.id,
        customerPhone: params.rawPhone,
        replyMessage,
        source: params.source ?? "customer_close",
      });
      return {
        handled: true,
        closed: false,
        ticketCode: lastClosed.code,
        ticketId: lastClosed.id,
        replyMessage,
      };
    }

    const replyMessage =
      "No encontré un caso abierto para cerrar. Si tenés una consulta nueva, contame en qué te puedo ayudar.";
    return {
      handled: true,
      closed: false,
      ticketCode: null,
      ticketId: null,
      replyMessage,
    };
  }

  const inboundText = params.messageText.trim() || "Cierre solicitado por el cliente";

  await db.ticketMessage.create({
    data: {
      ticketId: openTicket.id,
      direction: "INBOUND",
      from: "CUSTOMER",
      text: inboundText,
      rawPayload: {
        source: params.source ?? "customer_close_request",
        customerRequestedClose: true,
      },
      ...(params.externalMessageId ? { externalMessageId: params.externalMessageId } : {}),
    },
  });

  await db.ticket.update({
    where: { id: openTicket.id },
    data: {
      status: "RESOLVED",
      resolution: "CHAT_RESOLVED",
      lastMessageAt: new Date(),
      aiSummary:
        openTicket.aiSummary ??
        `Cierre solicitado por el cliente vía WhatsApp (${params.messageText.trim() || "sin texto"}).`,
    },
  });

  await db.ticketEvent.create({
    data: {
      ticketId: openTicket.id,
      type: "STATUS_CHANGED",
      payload: {
        status: "RESOLVED",
        resolution: "CHAT_RESOLVED",
        source: "customer_whatsapp_close_request",
        message: params.messageText,
      },
    },
  });

  const replyMessage = `Listo, cerré el caso *${openTicket.code}*. Gracias por escribirnos. Si necesitás algo más, quedo a disposición por este medio.`;

  await sendCloseReply({
    ticketId: openTicket.id,
    customerPhone: params.rawPhone,
    replyMessage,
    source: params.source ?? "customer_close",
  });

  console.log(`[customerClose] Caso ${openTicket.code} cerrado por pedido del cliente (${params.rawPhone})`);

  return {
    handled: true,
    closed: true,
    ticketCode: openTicket.code,
    ticketId: openTicket.id,
    replyMessage,
  };
}

async function sendCloseReply(params: {
  ticketId: string;
  customerPhone: string;
  replyMessage: string;
  source: string;
}): Promise<void> {
  try {
    await sendWhatsAppMessage({
      number: params.customerPhone,
      message: params.replyMessage,
    });
  } catch (err) {
    console.error(
      "[customerClose] Error enviando WhatsApp:",
      err instanceof Error ? err.message : err,
    );
  }

  try {
    await prisma.ticketMessage.create({
      data: {
        ticketId: params.ticketId,
        direction: "OUTBOUND",
        from: "BOT",
        text: params.replyMessage,
        rawPayload: {
          autoReply: true,
          autoReplyKind: "customer_requested_close",
          source: params.source,
        },
      },
    });
  } catch (err) {
    console.error("[customerClose] Error guardando outbound:", err);
  }
}
