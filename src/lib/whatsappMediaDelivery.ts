import { sendWhatsAppMessage } from "@/lib/builderbot";

/**
 * WhatsApp: primero la imagen (tarjeta/mapa), después el texto con detalle.
 * BuilderBot acepta mediaUrl + content; con caption largo la imagen pierde protagonismo.
 */
export async function sendWhatsAppTextWithOptionalMedia(params: {
  number: string;
  message: string;
  mediaUrl?: string;
}): Promise<void> {
  const message = String(params.message ?? "").trim();
  const mediaUrl = params.mediaUrl?.trim();

  if (mediaUrl) {
    await sendWhatsAppMessage({
      number: params.number,
      message: " ",
      mediaUrl,
    });
    if (message) {
      await sendWhatsAppMessage({ number: params.number, message });
    }
    return;
  }

  if (message) {
    await sendWhatsAppMessage({ number: params.number, message });
  }
}
