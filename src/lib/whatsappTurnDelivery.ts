import { sendWhatsAppMessage } from "@/lib/builderbot";
import { persistCustomerBotReply } from "@/lib/customerTicketInquiry";
import {
  bbcShouldSendExecutorMessage,
  shouldTurnSendWhatsAppToCustomer,
} from "@/lib/waraInboundAudit";

type JsonRecord = Record<string, unknown>;

/**
 * Fase 2 — Entrega al cliente: backend envía por API o BBC (legacy Fase 1).
 */
export async function deliverTurnToWhatsApp(
  rawPhone: string,
  payload: JsonRecord,
): Promise<JsonRecord> {
  const message = String(payload.message ?? payload.summaryText ?? "").trim();
  const nextFlow = String(payload.nextFlow_s ?? payload.nextFlow ?? "reply");

  if (!message || nextFlow === "ignore" || nextFlow === "router") {
    return { ...payload, message, skipResponse_s: "true" };
  }

  if (!shouldTurnSendWhatsAppToCustomer()) {
    const bbcSends = bbcShouldSendExecutorMessage();
    return {
      ...payload,
      message,
      skipResponse_s: bbcSends ? "false" : "true",
      waDelivery: bbcSends ? "bbc" : "none",
    };
  }

  try {
    await sendWhatsAppMessage({ number: rawPhone, message });
    await persistCustomerBotReply(rawPhone, message, {
      source: "whatsapp_turn",
      executor: payload.executor_s ?? payload.executor ?? "turn",
      waDelivery: "backend",
    });
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
