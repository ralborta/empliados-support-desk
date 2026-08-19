import { persistCustomerBotReply } from "@/lib/customerTicketInquiry";
import {
  bbcShouldSendExecutorMessage,
  shouldTurnSendWhatsAppToCustomer,
} from "@/lib/waraInboundAudit";
import { extractMediaUrlAndCleanText } from "@/lib/mediaUrlMarker";
import { sendWhatsAppTextWithOptionalMedia } from "@/lib/whatsappMediaDelivery";

type JsonRecord = Record<string, unknown>;

/**
 * Fase 2 — Entrega al cliente: backend envía por API o BBC (legacy Fase 1).
 */
export async function deliverTurnToWhatsApp(
  rawPhone: string,
  payload: JsonRecord,
): Promise<JsonRecord> {
  const extracted = extractMediaUrlAndCleanText(String(payload.message ?? payload.summaryText ?? "").trim());
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

  const mustSendViaBackend = shouldTurnSendWhatsAppToCustomer() || !!mediaUrl;

  const persistMeta = {
    source: "whatsapp_turn",
    executor: payload.executor_s ?? payload.executor ?? "turn",
    waDelivery: mustSendViaBackend ? "backend" : "bbc",
  };

  if (!mustSendViaBackend) {
    const bbcSends = bbcShouldSendExecutorMessage();
    await persistCustomerBotReply(rawPhone, message, persistMeta).catch(() => undefined);
    return {
      ...payload,
      message,
      skipResponse_s: bbcSends ? "false" : "true",
      waDelivery: bbcSends ? "bbc" : "none",
    };
  }

  try {
    await sendWhatsAppTextWithOptionalMedia({ number: rawPhone, message, mediaUrl });
    await persistCustomerBotReply(rawPhone, message, { ...persistMeta, waDelivery: "backend" });
    return {
      ...payload,
      message,
      summaryText: String(payload.summaryText ?? message),
      skipResponse_s: "true",
      waSent_s: "true",
      waDelivery: "backend",
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[whatsappTurn] Envío WA falló, fallback BBC messageMapping:", detail);
    return {
      ...payload,
      message,
      skipResponse_s: "false",
      waSent_s: "false",
      waDelivery: "bbc_fallback",
      waSendError: detail,
    };
  }
}
