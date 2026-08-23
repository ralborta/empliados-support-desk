import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import { OPEN_TICKET_THREAD_STATUSES } from "@/lib/ticketThreading";
import { findCustomerByWhatsAppNumber } from "@/lib/whatsappPhone";

/** Presave en panel (executor) ≠ envío iniciado ≠ aceptado por WhatsApp. */
export type WaTurnDeliveryState = "presaved" | "send_initiated" | "delivered";

export type WaTurnDeliveryMeta = {
  inboundDeliveryKey?: string;
  waDeliveryState?: WaTurnDeliveryState;
  waOutboundProviderId?: string;
};

function readDeliveryMeta(rawPayload: unknown): WaTurnDeliveryMeta {
  if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) return {};
  const nested = (rawPayload as Record<string, unknown>).waTurnDelivery;
  if (!nested || typeof nested !== "object" || Array.isArray(nested)) return {};
  const m = nested as Record<string, unknown>;
  const state = String(m.waDeliveryState ?? "").trim();
  const waDeliveryState =
    state === "send_initiated" || state === "delivered" || state === "presaved"
      ? (state as WaTurnDeliveryState)
      : undefined;
  return {
    inboundDeliveryKey:
      typeof m.inboundDeliveryKey === "string" ? m.inboundDeliveryKey.trim() : undefined,
    waDeliveryState,
    waOutboundProviderId:
      typeof m.waOutboundProviderId === "string" ? m.waOutboundProviderId.trim() : undefined,
  };
}

export function isInboundWamid(id: string | undefined | null): boolean {
  return /^wamid\./i.test(String(id ?? "").trim());
}

/** Clave estable: wamid del inbound o `inbound:<ticketMessageId>` persistido. */
export function inboundDeliveryKeyFromParts(params: {
  turnMessageId?: string;
  inboundMessageId?: string;
  inboundExternalMessageId?: string | null;
}): string | undefined {
  const turnId = String(params.turnMessageId ?? "").trim();
  if (isInboundWamid(turnId)) return turnId;
  const ext = String(params.inboundExternalMessageId ?? "").trim();
  if (isInboundWamid(ext)) return ext;
  const inboundId = String(params.inboundMessageId ?? "").trim();
  if (inboundId) return `inbound:${inboundId}`;
  return undefined;
}

export async function resolveInboundDeliveryContext(
  rawPhone: string,
  selectionText: string,
  turnMessageId: string | undefined,
  client: PrismaClient = prisma,
): Promise<{
  inboundDeliveryKey?: string;
  inboundMessageId?: string;
  deliveryState?: WaTurnDeliveryState;
  outboundProviderId?: string;
}> {
  const customer = await findCustomerByWhatsAppNumber(client, rawPhone);
  if (!customer) return {};

  const turnId = String(turnMessageId ?? "").trim();
  let inbound:
    | {
        id: string;
        externalMessageId: string | null;
        rawPayload: unknown;
      }
    | null
    | undefined;

  if (isInboundWamid(turnId)) {
    inbound = await client.ticketMessage.findFirst({
      where: {
        direction: "INBOUND",
        from: "CUSTOMER",
        externalMessageId: turnId,
        ticket: { customerId: customer.id },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, externalMessageId: true, rawPayload: true },
    });
  }

  const text = String(selectionText ?? "").trim();
  if (!inbound && text) {
    const since = new Date(Date.now() - 3 * 60 * 1000);
    inbound = await client.ticketMessage.findFirst({
      where: {
        ticket: { customerId: customer.id },
        direction: "INBOUND",
        from: "CUSTOMER",
        text,
        createdAt: { gte: since },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, externalMessageId: true, rawPayload: true },
    });
  }

  if (!inbound) {
    const key = inboundDeliveryKeyFromParts({ turnMessageId: turnId });
    return key ? { inboundDeliveryKey: key } : {};
  }

  const meta = readDeliveryMeta(inbound.rawPayload);
  const key = inboundDeliveryKeyFromParts({
    turnMessageId: turnId,
    inboundMessageId: inbound.id,
    inboundExternalMessageId: inbound.externalMessageId,
  });

  return {
    inboundDeliveryKey: key,
    inboundMessageId: inbound.id,
    deliveryState: meta.waDeliveryState,
    outboundProviderId: meta.waOutboundProviderId,
  };
}

async function mergeInboundDeliveryMeta(
  client: PrismaClient,
  inboundMessageId: string,
  patch: WaTurnDeliveryMeta,
): Promise<void> {
  const row = await client.ticketMessage.findUnique({
    where: { id: inboundMessageId },
    select: { rawPayload: true },
  });
  if (!row) return;
  const prior =
    row.rawPayload && typeof row.rawPayload === "object" && !Array.isArray(row.rawPayload)
      ? (row.rawPayload as Record<string, unknown>)
      : {};
  const priorMeta = readDeliveryMeta(prior);
  const merged: WaTurnDeliveryMeta = {
    inboundDeliveryKey: patch.inboundDeliveryKey ?? priorMeta.inboundDeliveryKey,
    waDeliveryState: patch.waDeliveryState ?? priorMeta.waDeliveryState,
    waOutboundProviderId: patch.waOutboundProviderId ?? priorMeta.waOutboundProviderId,
  };
  await client.ticketMessage.update({
    where: { id: inboundMessageId },
    data: {
      rawPayload: {
        ...prior,
        waTurnDelivery: merged,
      } as Prisma.InputJsonObject,
    },
  });
}

export async function markInboundDeliverySendInitiated(
  inboundMessageId: string,
  inboundDeliveryKey: string,
  client: PrismaClient = prisma,
): Promise<void> {
  await mergeInboundDeliveryMeta(client, inboundMessageId, {
    inboundDeliveryKey,
    waDeliveryState: "send_initiated",
  });
}

export async function markInboundDeliveryDelivered(
  inboundMessageId: string,
  inboundDeliveryKey: string,
  waOutboundProviderId: string,
  client: PrismaClient = prisma,
): Promise<void> {
  await mergeInboundDeliveryMeta(client, inboundMessageId, {
    inboundDeliveryKey,
    waDeliveryState: "delivered",
    waOutboundProviderId,
  });
}

/** Presave del executor: OUTBOUND en panel sin estado de entrega WA. */
export async function simulateExecutorPresaveOutbound(
  client: PrismaClient,
  params: {
    ticketId: string;
    text: string;
    executor?: string;
  },
): Promise<{ id: string }> {
  const message = params.text.trim();
  const row = await client.ticketMessage.create({
    data: {
      ticketId: params.ticketId,
      direction: "OUTBOUND",
      from: "BOT",
      text: message,
      rawPayload: {
        source: `wara_${params.executor ?? "odometro"}_response`,
        waDeliveryState: "presaved",
        stage: "integration_presave",
      },
    },
    select: { id: true },
  });
  return row;
}
