import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import { sendWhatsAppMessage } from "@/lib/builderbot";
import { OPEN_TICKET_THREAD_STATUSES } from "@/lib/ticketThreading";
import { shouldInboundSendWhatsAppToCustomer } from "@/lib/waraInboundAudit";
import { findCustomerByWhatsAppNumber } from "@/lib/whatsappPhone";
import { reactivateAtilioAfterTicketClosed } from "@/lib/atilioBotPause";
import {
  CUSTOMER_CLOSE_SUCCESS_MESSAGE,
  looksLikeCustomerConversationCloseRequest,
} from "@/lib/customerConversationCloseDetect";

export {
  CUSTOMER_CLOSE_SUCCESS_MESSAGE,
  looksLikeCustomerConversationCloseRequest,
} from "@/lib/customerConversationCloseDetect";

const RECENT_CUSTOMER_CLOSE_MS = 2 * 60 * 1000;

async function wasRecentlyClosedByCustomer(
  db: PrismaClient,
  ticketId: string,
): Promise<boolean> {
  const event = await db.ticketEvent.findFirst({
    where: {
      ticketId,
      type: "STATUS_CHANGED",
      createdAt: { gte: new Date(Date.now() - RECENT_CUSTOMER_CLOSE_MS) },
    },
    orderBy: { createdAt: "desc" },
  });
  if (!event?.payload || typeof event.payload !== "object" || Array.isArray(event.payload)) {
    return false;
  }
  return (event.payload as Record<string, unknown>).source === "customer_whatsapp_close_request";
}

async function hasRecentCloseConfirmation(db: PrismaClient, ticketId: string): Promise<boolean> {
  const recent = await db.ticketMessage.findFirst({
    where: {
      ticketId,
      direction: "OUTBOUND",
      from: "BOT",
      createdAt: { gte: new Date(Date.now() - RECENT_CUSTOMER_CLOSE_MS) },
    },
    orderBy: { createdAt: "desc" },
  });
  if (!recent?.rawPayload || typeof recent.rawPayload !== "object" || Array.isArray(recent.rawPayload)) {
    return false;
  }
  return (recent.rawPayload as Record<string, unknown>).autoReplyKind === "customer_requested_close";
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
      const justClosedByCustomer = await wasRecentlyClosedByCustomer(db, lastClosed.id);
      const replyMessage = justClosedByCustomer
        ? CUSTOMER_CLOSE_SUCCESS_MESSAGE
        : "Tu consulta ya estaba cerrada. Si necesitás algo más, escribime y abrimos una nueva consulta.";
      const alreadySent = justClosedByCustomer && (await hasRecentCloseConfirmation(db, lastClosed.id));
      if (!alreadySent) {
        await sendCloseReply({
          ticketId: lastClosed.id,
          customerPhone: params.rawPhone,
          replyMessage,
          source: params.source ?? "customer_close",
        });
      }
      return {
        handled: true,
        closed: justClosedByCustomer,
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

  await reactivateAtilioAfterTicketClosed(
    {
      customerId: customer.id,
      ticketId: openTicket.id,
      previousStatus: openTicket.status,
      newStatus: "RESOLVED",
      reason: "customer-requested-close",
    },
    db,
  );

  const replyMessage = CUSTOMER_CLOSE_SUCCESS_MESSAGE;

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
  const deliverWa = shouldInboundSendWhatsAppToCustomer();
  if (!deliverWa) {
    // Audit-only: el webhook no es la voz. Persistir acá crea un mensaje en el
    // panel que nunca salió por WhatsApp. BBC/V3 envía y el outgoing lo guarda.
    console.log(
      `[customerClose] Audit-only: confirmación de cierre no enviada ni persistida (BBC/V3 es la voz): ${params.replyMessage.slice(0, 80)}…`,
    );
    return;
  }

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
          waSuppressed: false,
        },
      },
    });
  } catch (err) {
    console.error("[customerClose] Error guardando outbound:", err);
  }
}
