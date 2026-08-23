import { persistCustomerBotReply } from "@/lib/customerTicketInquiry";
import { prisma } from "@/lib/db";
import { extractMediaUrlAndCleanText } from "@/lib/mediaUrlMarker";
import { findPlatformPresavedOutboundDuplicate } from "@/lib/outboundMessageDedup";
import { OPEN_TICKET_THREAD_STATUSES } from "@/lib/ticketThreading";
import { shouldDeliverWhatsAppToProtectedClient } from "@/lib/waraTurnDeliveryGuard";
import { findCustomerByWhatsAppNumber } from "@/lib/whatsappPhone";
import { sendWhatsAppTextWithOptionalMedia } from "@/lib/whatsappMediaDelivery";

type JsonRecord = Record<string, unknown>;

/**
 * Entrega al cliente: el backend SIEMPRE intenta enviar por API BuilderBot.
 * BBC (skipResponse_s=false) solo como fallback si la API falla.
 *
 * Bug real 2026-08-22/23: con WARA_TURN_BACKEND_SEND=false el texto iba solo por
 * messageMapping de BBC → silencios (Nissan “no encontré”) y captions “ ” → “.”
 * en GPS con imagen. Nunca dejar al cliente sin respuesta cuando hay mensaje.
 *
 * Bug real 2026-08-23: tras enviar por API, devolver el mismo `message` a BBC hacía
 * que messageMapping re-enviara el texto → respuestas duplicadas (odómetro, etc.).
 * Si la API OK: vaciar message/summaryText para BBC y dejar skipResponse_s=true.
 */
export async function deliverTurnToWhatsApp(
  rawPhone: string,
  payload: JsonRecord,
): Promise<JsonRecord> {
  const extracted = extractMediaUrlAndCleanText(
    String(payload.message ?? payload.summaryText ?? "").trim(),
  );
  const message = extracted.text;
  const explicitMedia = String(payload.mediaUrl ?? payload.mediaUrl_s ?? "").trim();
  const mediaUrl =
    (explicitMedia && /^https?:\/\//i.test(explicitMedia) ? explicitMedia : undefined) ??
    extracted.mediaUrl;
  const nextFlow = String(payload.nextFlow_s ?? payload.nextFlow ?? "reply");

  if (!message || nextFlow === "ignore") {
    return { ...payload, message, skipResponse_s: "true" };
  }

  if (nextFlow === "router") {
    return { ...payload, message, skipResponse_s: "true", nextFlow, nextFlow_s: nextFlow };
  }

  const selectionText = String(payload.turnSelectionText ?? "").trim();
  const turnMessageId = String(payload.turnMessageId ?? "").trim() || undefined;

  if (
    !(await shouldDeliverWhatsAppToProtectedClient(rawPhone, selectionText, {
      messageId: turnMessageId,
    }))
  ) {
    return {
      ...payload,
      message: "",
      summaryText: "",
      skipResponse_s: "true",
      waDelivery: "protected_blocked",
      waDelivery_s: "protected_blocked",
    };
  }

  const customer = await findCustomerByWhatsAppNumber(prisma, rawPhone);
  if (customer) {
    const ticket =
      (await prisma.ticket.findFirst({
        where: { customerId: customer.id, status: { in: OPEN_TICKET_THREAD_STATUSES } },
        orderBy: { lastMessageAt: "desc" },
      })) ??
      (await prisma.ticket.findFirst({
        where: { customerId: customer.id },
        orderBy: { lastMessageAt: "desc" },
      }));
    if (ticket) {
      const dup = await findPlatformPresavedOutboundDuplicate(prisma, {
        ticketId: ticket.id,
        text: message,
        windowMs: 120_000,
      });
      if (dup) {
        console.log("[whatsappTurn] Skip outbound duplicado (mismo texto <120s)", rawPhone);
        return {
          ...payload,
          message: "",
          summaryText: "",
          skipResponse_s: "true",
          duplicateOutbound_s: "true",
          waDelivery: "duplicate_skipped",
        };
      }
    }
  }

  const persistMeta = {
    source: "whatsapp_turn",
    executor: payload.executor_s ?? payload.executor ?? "turn",
    waDelivery: "backend",
  };

  try {
    await sendWhatsAppTextWithOptionalMedia({ number: rawPhone, message, mediaUrl });
    await persistCustomerBotReply(rawPhone, message, persistMeta).catch(() => undefined);
    return {
      ...payload,
      // Vaciar para BBC: ya salió por API; si BBC ignora skipResponse no debe reenviar.
      message: "",
      summaryText: "",
      deliveredMessage: message,
      deliveredMessage_s: message,
      skipResponse_s: "true",
      waSent_s: "true",
      waDelivery: "backend",
      ...(mediaUrl ? { mediaUrl: "", mediaUrl_s: "" } : {}),
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[whatsappTurn] Envío WA falló, fallback BBC messageMapping:", detail);
    await persistCustomerBotReply(rawPhone, message, {
      ...persistMeta,
      waDelivery: "bbc_fallback",
      waSendError: detail,
    }).catch(() => undefined);
    return {
      ...payload,
      message,
      summaryText: String(payload.summaryText ?? message),
      skipResponse_s: "false",
      waSent_s: "false",
      waDelivery: "bbc_fallback",
      waSendError: detail,
      ...(mediaUrl ? { mediaUrl, mediaUrl_s: mediaUrl } : {}),
    };
  }
}
