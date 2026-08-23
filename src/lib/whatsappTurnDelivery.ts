import { persistCustomerBotReply } from "@/lib/customerTicketInquiry";
import { prisma } from "@/lib/db";
import {
  bbcShouldSendExecutorMessage,
  shouldTurnSendWhatsAppToCustomer,
} from "@/lib/waraInboundAudit";
import { extractMediaUrlAndCleanText } from "@/lib/mediaUrlMarker";
import { sendWhatsAppMessage } from "@/lib/builderbot";
import { sendWhatsAppTextWithOptionalMedia } from "@/lib/whatsappMediaDelivery";
import { shouldDeliverWhatsAppToProtectedClient } from "@/lib/waraTurnDeliveryGuard";
import {
  markInboundDeliveryDelivered,
  markInboundDeliverySendInitiated,
  resolveInboundDeliveryContext,
} from "@/lib/turnWhatsAppDeliveryLedger";

type JsonRecord = Record<string, unknown>;

export type TurnDeliveryDeps = {
  prisma: typeof prisma;
  sendWhatsApp: typeof sendWhatsAppTextWithOptionalMedia;
  sendWhatsAppMessage: typeof sendWhatsAppMessage;
};

const defaultDeps: TurnDeliveryDeps = {
  prisma,
  sendWhatsApp: sendWhatsAppTextWithOptionalMedia,
  sendWhatsAppMessage,
};

/**
 * Entrega al cliente: API BuilderBot cuando WARA_TURN_BACKEND_SEND=true (default);
 * BBC messageMapping como fallback si falla la API o rollback explícito del flag.
 *
 * Idempotencia por inbound wamid o `inbound:<ticketMessageId>` — nunca por texto.
 * Presave del executor ≠ entregado: solo `delivered` tras API OK con id del proveedor.
 */
export function createDeliverTurnToWhatsApp(deps: TurnDeliveryDeps) {
  return async function deliverTurnToWhatsApp(
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
        client: deps.prisma,
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

    const backendSendsAll = shouldTurnSendWhatsAppToCustomer();
    const gpsMediaViaApi = !!mediaUrl && !backendSendsAll;

    const persistMeta = {
      source: "whatsapp_turn",
      executor: payload.executor_s ?? payload.executor ?? "turn",
      waDelivery: backendSendsAll ? "backend" : gpsMediaViaApi ? "gps_media_bbc_text" : "bbc",
    };

    if (gpsMediaViaApi) {
      let mediaSent = false;
      try {
        await deps.sendWhatsAppMessage({ number: rawPhone, message: "📍", mediaUrl });
        mediaSent = true;
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        console.error("[whatsappTurn] Envío imagen GPS falló:", detail);
      }
      const bbcSends = bbcShouldSendExecutorMessage();
      await persistCustomerBotReply(rawPhone, message, {
        ...persistMeta,
        waMediaSent_s: mediaSent ? "true" : "false",
      }).catch(() => undefined);
      return {
        ...payload,
        message,
        summaryText: String(payload.summaryText ?? message),
        skipResponse_s: bbcSends ? "false" : "true",
        waSent_s: mediaSent ? "true" : "false",
        waDelivery: "gps_media_bbc_text",
        ...(mediaUrl ? { mediaUrl, mediaUrl_s: mediaUrl } : {}),
      };
    }

    if (!backendSendsAll) {
      const bbcSends = bbcShouldSendExecutorMessage();
      await persistCustomerBotReply(rawPhone, message, persistMeta, deps.prisma).catch(
        () => undefined,
      );
      return {
        ...payload,
        message,
        summaryText: String(payload.summaryText ?? message),
        skipResponse_s: bbcSends ? "false" : "true",
        waDelivery: bbcSends ? "bbc" : "none",
      };
    }

    const inboundCtx = await resolveInboundDeliveryContext(
      rawPhone,
      selectionText,
      turnMessageId,
      deps.prisma,
    );

    if (
      inboundCtx.deliveryState === "delivered" &&
      inboundCtx.inboundDeliveryKey &&
      inboundCtx.outboundProviderId
    ) {
      return {
        ...payload,
        message: "",
        summaryText: "",
        skipResponse_s: "true",
        waDelivery: "idempotent_inbound",
        waDelivery_s: "idempotent_inbound",
        inboundDeliveryKey: inboundCtx.inboundDeliveryKey,
        waOutboundProviderId: inboundCtx.outboundProviderId,
        duplicateInbound_s: "true",
      };
    }

    if (inboundCtx.inboundMessageId && inboundCtx.inboundDeliveryKey) {
      await markInboundDeliverySendInitiated(
        inboundCtx.inboundMessageId,
        inboundCtx.inboundDeliveryKey,
        deps.prisma,
      );
    }

    try {
      const sendResult = await deps.sendWhatsApp({ number: rawPhone, message, mediaUrl });
      const providerId = String(sendResult.providerMessageId ?? "").trim();
      if (!providerId) {
        throw new Error("BuilderBot API OK sin identificador de mensaje saliente");
      }

      if (inboundCtx.inboundMessageId && inboundCtx.inboundDeliveryKey) {
        await markInboundDeliveryDelivered(
          inboundCtx.inboundMessageId,
          inboundCtx.inboundDeliveryKey,
          providerId,
          deps.prisma,
        );
      }

      await persistCustomerBotReply(rawPhone, message, {
        ...persistMeta,
        waDelivery: "backend",
        waOutboundProviderId: providerId,
        inboundDeliveryKey: inboundCtx.inboundDeliveryKey,
        waDeliveryState: "delivered",
      }, deps.prisma).catch(() => undefined);

      return {
        ...payload,
        message: "",
        summaryText: "",
        deliveredMessage: message,
        deliveredMessage_s: message,
        skipResponse_s: "true",
        waSent_s: "true",
        waDelivery: "backend",
        waOutboundProviderId: providerId,
        inboundDeliveryKey: inboundCtx.inboundDeliveryKey,
        ...(sendResult.skippedDuplicate ? { waSkippedDuplicate_s: "true" } : {}),
        ...(mediaUrl ? { mediaUrl: "", mediaUrl_s: "" } : {}),
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("[whatsappTurn] Envío WA falló, fallback BBC messageMapping:", detail);
      await persistCustomerBotReply(rawPhone, message, {
        ...persistMeta,
        waDelivery: "bbc_fallback",
        waSendError: detail,
      }, deps.prisma).catch(() => undefined);
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
  };
}

export const deliverTurnToWhatsApp = createDeliverTurnToWhatsApp(defaultDeps);
