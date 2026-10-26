import { sendWhatsAppMessage } from "@/lib/builderbot";
import {
  extractBuilderBotOutboundMessageId,
  type WhatsAppApiSendResult,
} from "@/lib/builderbotSendResult";

function isPdfMediaUrl(mediaUrl: string): boolean {
  return /\.pdf(\?|$)/i.test(mediaUrl);
}

export type SendWhatsAppMediaParams = {
  number: string;
  message: string;
  mediaUrl?: string;
  /**
   * Se ejecuta inmediatamente antes de cada llamada al proveedor.
   * Si retorna false, se aborta sin más envíos (p. ej. pausa humana entre texto y PDF).
   */
  beforeEachProviderCall?: () => Promise<boolean>;
};

export type SendWhatsAppMediaResult =
  | WhatsAppApiSendResult
  | { skipped: true; reason: "before_each_blocked"; providerMessageId?: string };

/**
 * WhatsApp con media opcional.
 * - Imagen/mapa GPS: primero media (tarjeta), después texto (detalle).
 * - PDF (guía): primero texto explicativo, después el documento.
 */
export async function sendWhatsAppTextWithOptionalMedia(
  params: SendWhatsAppMediaParams,
): Promise<SendWhatsAppMediaResult> {
  const message = String(params.message ?? "").trim();
  const mediaUrl = params.mediaUrl?.trim();

  const before = async (): Promise<boolean> => {
    if (!params.beforeEachProviderCall) return true;
    return params.beforeEachProviderCall();
  };

  if (mediaUrl) {
    const mediaCaption = isPdfMediaUrl(mediaUrl) ? "📄 Guía Wara" : "📍";
    const textFirst = isPdfMediaUrl(mediaUrl);

    if (textFirst && message) {
      if (!(await before())) return { skipped: true, reason: "before_each_blocked" };
      const textRes = await sendWhatsAppMessage({ number: params.number, message });
      if ((textRes as { skippedDuplicate?: boolean })?.skippedDuplicate) {
        return { skippedDuplicate: true };
      }
      const textId = extractBuilderBotOutboundMessageId(textRes);

      if (!(await before())) {
        return { skipped: true, reason: "before_each_blocked", providerMessageId: textId };
      }
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

    if (!(await before())) return { skipped: true, reason: "before_each_blocked" };
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
      if (!(await before())) {
        return { skipped: true, reason: "before_each_blocked", providerMessageId: mediaId };
      }
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
      return { rawResponse: mediaRes };
    }
    return { providerMessageId: mediaId, rawResponse: mediaRes };
  }

  if (message) {
    if (!(await before())) return { skipped: true, reason: "before_each_blocked" };
    const res = await sendWhatsAppMessage({ number: params.number, message });
    if ((res as { skippedDuplicate?: boolean })?.skippedDuplicate) {
      return { skippedDuplicate: true };
    }
    const providerMessageId = extractBuilderBotOutboundMessageId(res);
    return { providerMessageId, rawResponse: res };
  }

  return {};
}
