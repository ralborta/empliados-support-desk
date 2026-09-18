import type { Prisma, PrismaClient } from "@prisma/client";

/** Ventana para fusionar webhook BuilderBot / persist V3 / pre-guardado del backend. */
export const PLATFORM_OUTBOUND_PRESAVE_DEDUP_MS = 30_000;

export function normalizeOutboundDedupText(text: string | undefined | null): string {
  return (text ?? "").trim() || "[Archivo adjunto]";
}

export type PanelMessageIdKind = "wamid" | "v3" | "empty" | "other";

export function panelMessageIdKind(externalMessageId: string | null | undefined): PanelMessageIdKind {
  const id = (externalMessageId ?? "").trim();
  if (!id) return "empty";
  if (/wamid\./i.test(id)) return "wamid";
  if (/v3-(in|out)-/i.test(id)) return "v3";
  return "other";
}

/** wamid > v3 > other > empty — al fusionar, nos quedamos con el id más estable. */
export function preferExternalMessageId(
  current: string | null | undefined,
  incoming: string,
): string {
  const rank = (kind: PanelMessageIdKind) =>
    kind === "wamid" ? 3 : kind === "v3" ? 2 : kind === "other" ? 1 : 0;
  return rank(panelMessageIdKind(incoming)) > rank(panelMessageIdKind(current))
    ? incoming
    : current || incoming;
}

export type PanelContentDedupAction = "idempotent" | "merge" | "skip" | "create";

/**
 * BBC (wamid) y V3 (`v3-in` / `v3-out`) persisten el mismo turno con IDs distintos.
 * Dos wamid distintos con el mismo texto son envíos reales (no fusionar).
 */
export function decidePanelContentDedup(params: {
  existingExternalMessageId: string | null | undefined;
  incomingExternalMessageId: string;
}): { action: PanelContentDedupAction } {
  const existing = params.existingExternalMessageId ?? null;
  const incoming = params.incomingExternalMessageId;
  if (existing && existing === incoming) return { action: "idempotent" };

  const existKind = panelMessageIdKind(existing);
  const incomingKind = panelMessageIdKind(incoming);

  if (existKind === "wamid" && incomingKind === "wamid") return { action: "create" };
  if (existKind === "other" && incomingKind === "other") return { action: "create" };

  if (existKind === "wamid") return { action: "skip" };
  if (incomingKind === "wamid") return { action: "merge" };
  if (existKind === "empty" && incomingKind === "v3") return { action: "merge" };
  if (existKind === "v3" && incomingKind === "v3") return { action: "skip" };
  if (existKind === "empty") return { action: "merge" };
  return { action: "skip" };
}

export async function findRecentSameContentMessage(
  client: PrismaClient,
  params: {
    ticketId: string;
    direction: "INBOUND" | "OUTBOUND";
    from: "CUSTOMER" | "BOT" | "HUMAN";
    text: string;
    windowMs?: number;
  },
) {
  const text = normalizeOutboundDedupText(params.text);
  const windowMs = params.windowMs ?? PLATFORM_OUTBOUND_PRESAVE_DEDUP_MS;
  return client.ticketMessage.findFirst({
    where: {
      ticketId: params.ticketId,
      direction: params.direction,
      from: params.from,
      text,
      createdAt: { gte: new Date(Date.now() - windowMs) },
    },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * El backend persiste la respuesta del bot antes de que llegue el webhook
 * `message.outgoing` (appendOutboundBotMessage, persistCustomerBotReply, etc.).
 * Esa fila no tiene wamid; también llega una copia V3 (`v3-out-*`).
 */
export async function findPlatformPresavedOutboundDuplicate(
  client: PrismaClient,
  params: { ticketId: string; text: string; windowMs?: number },
) {
  return findRecentSameContentMessage(client, {
    ticketId: params.ticketId,
    direction: "OUTBOUND",
    from: "BOT",
    text: params.text,
    windowMs: params.windowMs,
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
    select: { rawPayload: true, externalMessageId: true },
  });
  const prior =
    existing?.rawPayload && typeof existing.rawPayload === "object" && !Array.isArray(existing.rawPayload)
      ? (existing.rawPayload as Record<string, unknown>)
      : {};

  await client.ticketMessage.update({
    where: { id: params.messageId },
    data: {
      externalMessageId: preferExternalMessageId(existing?.externalMessageId, params.externalMessageId),
      rawPayload: {
        ...prior,
        webhookOutgoing: params.webhookRawPayload,
      } as Prisma.InputJsonObject,
    },
  });
}
