import { sendWhatsAppMessage } from "@/lib/builderbot";
import { persistCustomerBotReply } from "@/lib/customerTicketInquiry";
import { isTurnReplyStale } from "@/lib/conversationThread";
import {
  bbcShouldSendExecutorMessage,
  shouldTurnSendWhatsAppToCustomer,
} from "@/lib/waraInboundAudit";

type JsonRecord = Record<string, unknown>;

export type TurnDeliveryOpts = {
  answeringText?: string;
  startedAt?: number;
};

/**
 * Fase 2 — Entrega al cliente: backend envía por API o BBC (legacy Fase 1).
 */
export async function deliverTurnToWhatsApp(
  rawPhone: string,
  payload: JsonRecord,
  opts?: TurnDeliveryOpts,
): Promise<JsonRecord> {
  const message = String(payload.message ?? payload.summaryText ?? "").trim();
  const nextFlow = String(payload.nextFlow_s ?? payload.nextFlow ?? "reply");

  if (
    message &&
    opts?.answeringText &&
    opts.startedAt &&
    (await isTurnReplyStale(rawPhone, opts.answeringText, opts.startedAt))
  ) {
    console.info(
      `[whatsappTurn] drop stale reply phone=${rawPhone.slice(0, 4)}… answering="${String(opts.answeringText).slice(0, 40)}"`,
    );
    return { ...payload, message: "", skipResponse_s: "true", stale_s: "true" };
  }

  if (!message || nextFlow === "ignore") {
    return { ...payload, message, skipResponse_s: "true" };
  }

  if (nextFlow === "router") {
    return { ...payload, message, skipResponse_s: "true", nextFlow, nextFlow_s: nextFlow };
  }

  const persistMeta = {
    source: "whatsapp_turn",
    executor: payload.executor_s ?? payload.executor ?? "turn",
    waDelivery: shouldTurnSendWhatsAppToCustomer() ? "backend" : "bbc",
  };

  if (!shouldTurnSendWhatsAppToCustomer()) {
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
    await sendWhatsAppMessage({ number: rawPhone, message });
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
