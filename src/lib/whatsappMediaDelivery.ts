import { sendWhatsAppMessage } from "@/lib/builderbot";
import {
  extractBuilderBotOutboundMessageId,
  type WhatsAppApiSendResult,
} from "@/lib/builderbotSendResult";

function isPdfMediaUrl(mediaUrl: string): boolean {
  return /\.pdf(\?|$)/i.test(mediaUrl);
}

/**
 * WhatsApp con media opcional.
 * - Imagen/mapa GPS: primero media (tarjeta), después texto (detalle).
 * - PDF (guía): primero texto explicativo, después el documento.
 */
export async function sendWhatsAppTextWithOptionalMedia(params: {
  number: string;
  message: string;
  mediaUrl?: string;
}): Promise<WhatsAppApiSendResult> {
  const message = String(params.message ?? "").trim();
  const mediaUrl = params.mediaUrl?.trim();

  if (mediaUrl) {
    const mediaCaption = isPdfMediaUrl(mediaUrl) ? "📄 Guía Wara" : "📍";
    const textFirst = isPdfMediaUrl(mediaUrl);

    if (textFirst && message) {
      const textRes = await sendWhatsAppMessage({ number: params.number, message });
      if ((textRes as { skippedDuplicate?: boolean })?.skippedDuplicate) {
        return { skippedDuplicate: true };
      }
      const textId = extractBuilderBotOutboundMessageId(textRes);
      const mediaRes = await sendWhatsAppMessage({
        number: params.number,
        message: mediaCaption,
        mediaUrl,
      });
      if ((mediaRes as { skippedDuplicate?: boolean })?.skippedDuplicate) {
        return { skippedDuplicate: true, providerMessageId: textId };
      }
      const mediaId = extractBuilderBotOutboundMessageId(mediaRes);
      return {
        providerMessageId: mediaId ?? textId,
        rawResponse: mediaRes,
      };
    }

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
