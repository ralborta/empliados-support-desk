import type { Prisma, PrismaClient } from "@prisma/client";
import { preferExternalMessageId } from "@/lib/outboundMessageDedup";

export type PanelDeliveryStatus =
  | "pending"
  | "sent"
  | "failed"
  | "confirmation_pending";

export type PanelAuthorship = "human" | "bot" | "unconfirmed";

export const PANEL_ATTEMPT_EXTERNAL_PREFIX = "attempt:";

export function panelAttemptExternalId(attemptId: string): string {
  return `${PANEL_ATTEMPT_EXTERNAL_PREFIX}${attemptId}`;
}

export function parsePanelAttemptExternalId(
  externalMessageId: string | null | undefined,
): string | null {
  const id = (externalMessageId ?? "").trim();
  if (!id.startsWith(PANEL_ATTEMPT_EXTERNAL_PREFIX)) return null;
  const attemptId = id.slice(PANEL_ATTEMPT_EXTERNAL_PREFIX.length).trim();
  return attemptId || null;
}

export function isPanelAttemptExternalId(
  externalMessageId: string | null | undefined,
): boolean {
  return Boolean(parsePanelAttemptExternalId(externalMessageId));
}

export function readPanelOutboundMeta(rawPayload: unknown): {
  clientAttemptId: string | null;
  deliveryStatus: PanelDeliveryStatus | null;
  authorship: PanelAuthorship | null;
  source: string | null;
  bbcCalledAt: string | null;
  attemptText: string | null;
  providerMessageId: string | null;
} {
  if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) {
    return {
      clientAttemptId: null,
      deliveryStatus: null,
      authorship: null,
      source: null,
      bbcCalledAt: null,
      attemptText: null,
      providerMessageId: null,
    };
  }
  const p = rawPayload as Record<string, unknown>;
  const status = p.deliveryStatus;
  const authorship = p.authorship;
  return {
    clientAttemptId: typeof p.clientAttemptId === "string" ? p.clientAttemptId : null,
    deliveryStatus:
      status === "pending" ||
      status === "sent" ||
      status === "failed" ||
      status === "confirmation_pending"
        ? status
        : null,
    authorship:
      authorship === "human" || authorship === "bot" || authorship === "unconfirmed"
        ? authorship
        : null,
    source: typeof p.source === "string" ? p.source : null,
    bbcCalledAt: typeof p.bbcCalledAt === "string" ? p.bbcCalledAt : null,
    attemptText: typeof p.attemptText === "string" ? p.attemptText : null,
    providerMessageId: typeof p.providerMessageId === "string" ? p.providerMessageId : null,
  };
}

export function buildPanelHumanPendingPayload(params: {
  clientAttemptId: string;
  advisorUserId: string;
  attemptText: string;
  prior?: Record<string, unknown>;
}): Prisma.InputJsonObject {
  return {
    ...(params.prior || {}),
    source: "panel_human",
    authorship: "human",
    clientAttemptId: params.clientAttemptId,
    attemptText: params.attemptText,
    deliveryStatus: "pending",
    advisorUserId: params.advisorUserId,
  };
}

/** Timeout / red / sin response → no sabemos si BBC entregó. */
export function isAmbiguousProviderSendError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as {
    code?: string;
    message?: string;
    response?: { status?: number };
    cause?: { code?: string };
  };
  if (err.response?.status != null) return false;
  const code = String(err.code || err.cause?.code || "").toUpperCase();
  if (
    code === "ECONNABORTED" ||
    code === "ETIMEDOUT" ||
    code === "ECONNRESET" ||
    code === "ENOTFOUND" ||
    code === "EAI_AGAIN" ||
    code === "ECONNREFUSED"
  ) {
    return true;
  }
  const msg = String(err.message || "").toLowerCase();
  return (
    msg.includes("timeout") ||
    msg.includes("network error") ||
    msg.includes("socket hang up") ||
    msg.includes("aborted")
  );
}

export async function findPanelHumanAttemptById(
  client: PrismaClient,
  params: { ticketId: string; clientAttemptId: string },
) {
  const externalMessageId = panelAttemptExternalId(params.clientAttemptId);
  const byExternal = await client.ticketMessage.findFirst({
    where: {
      ticketId: params.ticketId,
      externalMessageId,
    },
  });
  if (byExternal) return byExternal;

  // Si el webhook ya reemplazó attempt: por wamid, buscamos por meta en ventana reciente.
  const recent = await client.ticketMessage.findMany({
    where: {
      ticketId: params.ticketId,
      direction: "OUTBOUND",
      from: "HUMAN",
      createdAt: { gte: new Date(Date.now() - 30 * 60 * 1000) },
    },
    orderBy: { createdAt: "desc" },
    take: 40,
  });
  return (
    recent.find((m) => readPanelOutboundMeta(m.rawPayload).clientAttemptId === params.clientAttemptId) ||
    null
  );
}

export async function updatePanelOutboundDelivery(
  client: PrismaClient,
  params: {
    messageId: string;
    deliveryStatus: PanelDeliveryStatus;
    patch?: Record<string, unknown>;
    externalMessageId?: string | null;
  },
): Promise<void> {
  const existing = await client.ticketMessage.findUnique({
    where: { id: params.messageId },
    select: { rawPayload: true, externalMessageId: true },
  });
  const prior =
    existing?.rawPayload &&
    typeof existing.rawPayload === "object" &&
    !Array.isArray(existing.rawPayload)
      ? (existing.rawPayload as Record<string, unknown>)
      : {};

  const nextExternal =
    params.externalMessageId != null
      ? preferExternalMessageId(existing?.externalMessageId, params.externalMessageId)
      : existing?.externalMessageId;

  await client.ticketMessage.update({
    where: { id: params.messageId },
    data: {
      ...(nextExternal !== undefined ? { externalMessageId: nextExternal } : {}),
      rawPayload: {
        ...prior,
        ...(params.patch || {}),
        deliveryStatus: params.deliveryStatus,
      } as Prisma.InputJsonObject,
    },
  });
}

export function messagePresentation(rawPayload: unknown): {
  deliveryStatus: PanelDeliveryStatus | null;
  authorship: PanelAuthorship | null;
  clientAttemptId: string | null;
} {
  const meta = readPanelOutboundMeta(rawPayload);
  return {
    deliveryStatus: meta.deliveryStatus,
    authorship: meta.authorship,
    clientAttemptId: meta.clientAttemptId,
  };
}
