import { sendWhatsAppMessage } from "@/lib/builderbot";
import {
  extractBuilderBotOutboundMessageId,
  type WhatsAppApiSendResult,
} from "@/lib/builderbotSendResult";

/**
 * WhatsApp: primero la imagen (tarjeta/mapa), después el texto con detalle.
 * BuilderBot acepta mediaUrl + content; con caption largo la imagen pierde protagonismo.
 */
export async function sendWhatsAppTextWithOptionalMedia(params: {
  number: string;
  message: string;
  mediaUrl?: string;
}): Promise<WhatsAppApiSendResult> {
  const message = String(params.message ?? "").trim();
  const mediaUrl = params.mediaUrl?.trim();

  if (mediaUrl) {
    const mediaCaption = /\.pdf(\?|$)/i.test(mediaUrl) ? "📄 Guía Wara" : "📍";
    const mediaRes = await sendWhatsAppMessage({
      number: params.number,
      message: mediaCaption,
      mediaUrl,
    });
    if ((mediaRes as { skippedDuplicate?: boolean })?.skippedDuplicate) {
      return { skippedDuplicate: true };
    }
    const mediaId = extractBuilderBotOutboundMessageId(mediaRes);
    if (message) {
      const textRes = await sendWhatsAppMessage({ number: params.number, message });
      if ((textRes as { skippedDuplicate?: boolean })?.skippedDuplicate) {
        return { skippedDuplicate: true, providerMessageId: mediaId };
      }
      const textId = extractBuilderBotOutboundMessageId(textRes);
      return {
        providerMessageId: textId ?? mediaId,
        rawResponse: textRes,
      };
    }
    if (!mediaId) {
      throw new Error("BuilderBot API OK sin identificador tras envío de media");
    }
    return { providerMessageId: mediaId, rawResponse: mediaRes };
  }

  if (message) {
    const res = await sendWhatsAppMessage({ number: params.number, message });
    if ((res as { skippedDuplicate?: boolean })?.skippedDuplicate) {
      return { skippedDuplicate: true };
    }
    const providerMessageId = extractBuilderBotOutboundMessageId(res);
    if (!providerMessageId) {
      throw new Error("BuilderBot API OK sin identificador de mensaje saliente");
    }
    return { providerMessageId, rawResponse: res };
  }

  return {};
}
