import type { Prisma, PrismaClient } from "@prisma/client";

/** Ventana para fusionar webhook BuilderBot con pre-guardado del backend (misma respuesta). */
export const PLATFORM_OUTBOUND_PRESAVE_DEDUP_MS = 30_000;

export function normalizeOutboundDedupText(text: string | undefined | null): string {
  return (text ?? "").trim() || "[Archivo adjunto]";
}

/**
 * El backend persiste la respuesta del bot antes de que llegue el webhook
 * `message.outgoing` (appendOutboundBotMessage, persistCustomerBotReply, etc.).
 * Esa fila no tiene externalMessageId; el webhook sí trae wamid estable.
 */
export async function findPlatformPresavedOutboundDuplicate(
  client: PrismaClient,
  params: { ticketId: string; text: string; windowMs?: number },
) {
  const text = normalizeOutboundDedupText(params.text);
  const windowMs = params.windowMs ?? PLATFORM_OUTBOUND_PRESAVE_DEDUP_MS;
  return client.ticketMessage.findFirst({
    where: {
      ticketId: params.ticketId,
      direction: "OUTBOUND",
      from: "BOT",
      text,
      externalMessageId: null,
      createdAt: { gte: new Date(Date.now() - windowMs) },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function mergeWebhookIntoPlatformOutbound(
  client: PrismaClient,
  params: {
    messageId: string;
    externalMessageId: string;
    webhookRawPayload: Prisma.InputJsonValue;
  },
): Promise<void> {
  const existing = await client.ticketMessage.findUnique({
    where: { id: params.messageId },
    select: { rawPayload: true },
  });
  const prior =
    existing?.rawPayload && typeof existing.rawPayload === "object" && !Array.isArray(existing.rawPayload)
      ? (existing.rawPayload as Record<string, unknown>)
      : {};

  await client.ticketMessage.update({
    where: { id: params.messageId },
    data: {
      externalMessageId: params.externalMessageId,
      rawPayload: {
        ...prior,
        webhookOutgoing: params.webhookRawPayload,
      } as Prisma.InputJsonObject,
    },
  });
}
