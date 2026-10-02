import { isBotPausedForPhone } from "@/lib/atilioBotPause";
import { prisma } from "@/lib/db";
import { sendWhatsAppMessage } from "@/lib/builderbot";
import { sendWhatsAppTextWithOptionalMedia } from "@/lib/whatsappMediaDelivery";
import type { WhatsAppApiSendResult } from "@/lib/builderbotSendResult";

/**
 * Autorización única para envíos automáticos de Kira (texto, media, errores).
 * Relee botPausedAt inmediatamente antes de cada llamada al proveedor.
 * Los envíos del asesor (panel HUMAN) NO usan este helper.
 */
export async function assertAutomaticBotMayDeliver(rawPhone: string): Promise<{
  allowed: boolean;
  reason?: "human_takeover_paused";
}> {
  if (await isBotPausedForPhone(rawPhone, prisma)) {
    return { allowed: false, reason: "human_takeover_paused" };
  }
  return { allowed: true };
}

export async function sendAutomaticBotTextWithOptionalMedia(params: {
  number: string;
  message: string;
  mediaUrl?: string;
  source: string;
}): Promise<
  | WhatsAppApiSendResult
  | { skipped: true; reason: "human_takeover_paused"; providerMessageId?: string }
> {
  const result = await sendWhatsAppTextWithOptionalMedia({
    number: params.number,
    message: params.message,
    mediaUrl: params.mediaUrl,
    beforeEachProviderCall: async () => {
      const gate = await assertAutomaticBotMayDeliver(params.number);
      if (!gate.allowed) {
        console.log(
          `[autoBotDelivery] bloqueado (${gate.reason}) source=${params.source} phone=${params.number.slice(0, 6)}…`,
        );
        return false;
      }
      return true;
    },
  });

  if ("skipped" in result && result.skipped) {
    return {
      skipped: true,
      reason: "human_takeover_paused",
      providerMessageId: result.providerMessageId,
    };
  }
  return result;
}

/** Último recurso de error del bot: también respeta la pausa humana. */
export async function sendAutomaticBotErrorFallback(params: {
  number: string;
  message: string;
  source: string;
}): Promise<boolean> {
  const gate = await assertAutomaticBotMayDeliver(params.number);
  if (!gate.allowed) {
    console.log(
      `[autoBotDelivery] error-fallback bloqueado (${gate.reason}) source=${params.source}`,
    );
    return false;
  }
  try {
    await sendWhatsAppMessage({
      number: params.number,
      message: params.message,
    });
    return true;
  } catch (err) {
    console.error(`[autoBotDelivery] error-fallback falló source=${params.source}:`, err);
    return false;
  }
}
