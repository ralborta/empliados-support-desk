import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import { findCustomerByWhatsAppNumber } from "@/lib/whatsappPhone";

/** Presave en panel (executor) ≠ envío iniciado ≠ aceptado por WhatsApp. */
export type WaTurnDeliveryState = "presaved" | "send_initiated" | "delivered";

export type WaTurnDeliveryMeta = {
  inboundDeliveryKey?: string;
  waDeliveryState?: WaTurnDeliveryState;
  waOutboundProviderId?: string;
  /** Epoch ms — reserva atómica de envío (no confundir con entrega WA). */
  sendInitiatedAt?: number;
  /** Identificador de la reserva actual; release/mark exigen coincidencia. */
  attemptId?: string;
};

/** Tras este TTL, `send_initiated` sin provider id puede reclamarse (crash intermedio). */
export const SEND_INITIATED_STALE_MS = 120_000;

export type AcquireInboundDeliveryResult =
  | { status: "acquired"; attemptId: string }
  | { status: "already_delivered"; outboundProviderId: string }
  | { status: "in_progress" }
  | { status: "lost_race" };

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
  const sendInitiatedAtRaw = m.sendInitiatedAt;
  const sendInitiatedAt =
    typeof sendInitiatedAtRaw === "number"
      ? sendInitiatedAtRaw
      : typeof sendInitiatedAtRaw === "string" && /^\d+$/.test(sendInitiatedAtRaw.trim())
        ? Number(sendInitiatedAtRaw.trim())
        : undefined;
  return {
    inboundDeliveryKey:
      typeof m.inboundDeliveryKey === "string" ? m.inboundDeliveryKey.trim() : undefined,
    waDeliveryState,
    waOutboundProviderId:
      typeof m.waOutboundProviderId === "string" ? m.waOutboundProviderId.trim() : undefined,
    sendInitiatedAt,
    attemptId: typeof m.attemptId === "string" ? m.attemptId.trim() : undefined,
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

export function isInboundTurnDeliveryComplete(rawPayload: unknown): boolean {
  const meta = readDeliveryMeta(rawPayload);
  return meta.waDeliveryState === "delivered" && !!meta.waOutboundProviderId;
}

export function isInboundTurnDeliveryInProgress(rawPayload: unknown): boolean {
  const meta = readDeliveryMeta(rawPayload);
  if (meta.waDeliveryState !== "send_initiated") return false;
  if (meta.waOutboundProviderId) return true;
  const at = meta.sendInitiatedAt ?? 0;
  if (!at) return true;
  return Date.now() - at < SEND_INITIATED_STALE_MS;
}

function priorPayloadObject(rawPayload: unknown): Record<string, unknown> {
  return rawPayload && typeof rawPayload === "object" && !Array.isArray(rawPayload)
    ? (rawPayload as Record<string, unknown>)
    : {};
}

function buildWaTurnDeliveryPatch(
  prior: Record<string, unknown>,
  patch: WaTurnDeliveryMeta,
): Prisma.InputJsonObject {
  const priorMeta = readDeliveryMeta(prior);
  const merged: WaTurnDeliveryMeta = {
    inboundDeliveryKey: patch.inboundDeliveryKey ?? priorMeta.inboundDeliveryKey,
    waDeliveryState: patch.waDeliveryState ?? priorMeta.waDeliveryState,
    waOutboundProviderId: patch.waOutboundProviderId ?? priorMeta.waOutboundProviderId,
    sendInitiatedAt: patch.sendInitiatedAt ?? priorMeta.sendInitiatedAt,
    attemptId: patch.attemptId ?? priorMeta.attemptId,
  };
  return {
    ...prior,
    waTurnDelivery: merged,
  } as Prisma.InputJsonObject;
}

export async function findInboundByExternalWamid(
  client: PrismaClient,
  wamid: string,
): Promise<{ id: string; rawPayload: unknown } | null> {
  const id = String(wamid ?? "").trim();
  if (!isInboundWamid(id)) return null;
  return client.ticketMessage.findFirst({
    where: {
      externalMessageId: id,
      direction: "INBOUND",
      from: "CUSTOMER",
    },
    select: { id: true, rawPayload: true },
  });
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
  attemptId?: string;
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
    attemptId: meta.attemptId,
  };
}

function evaluateAcquireFromMeta(meta: WaTurnDeliveryMeta): AcquireInboundDeliveryResult | null {
  if (meta.waDeliveryState === "delivered" && meta.waOutboundProviderId) {
    return { status: "already_delivered", outboundProviderId: meta.waOutboundProviderId };
  }
  if (meta.waOutboundProviderId) {
    return { status: "already_delivered", outboundProviderId: meta.waOutboundProviderId };
  }
  if (meta.waDeliveryState === "send_initiated") {
    const at = meta.sendInitiatedAt ?? 0;
    if (!at || Date.now() - at < SEND_INITIATED_STALE_MS) {
      return { status: "in_progress" };
    }
  }
  return null;
}

/**
 * Reserva atómica del derecho de envío (SELECT FOR UPDATE + UPDATE condicional JSONB).
 */
export async function tryAcquireInboundDeliverySendRight(
  inboundMessageId: string,
  inboundDeliveryKey: string,
  client: PrismaClient = prisma,
): Promise<AcquireInboundDeliveryResult> {
  return client.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM "TicketMessage" WHERE id = ${inboundMessageId} FOR UPDATE`;

    const row = await tx.ticketMessage.findUnique({
      where: { id: inboundMessageId },
      select: { rawPayload: true },
    });
    if (!row) return { status: "lost_race" };

    const prior = priorPayloadObject(row.rawPayload);
    const meta = readDeliveryMeta(prior);
    const precheck = evaluateAcquireFromMeta(meta);
    if (precheck) return precheck;

    const nowMs = Date.now();
    const staleThreshold = nowMs - SEND_INITIATED_STALE_MS;
    const attemptId = randomUUID();
    const nextPayload = buildWaTurnDeliveryPatch(prior, {
      inboundDeliveryKey,
      waDeliveryState: "send_initiated",
      sendInitiatedAt: nowMs,
      attemptId,
    });

    const updated = await tx.$executeRawUnsafe(
      `UPDATE "TicketMessage"
       SET "rawPayload" = $1::jsonb
       WHERE id = $2
       AND (
         ("rawPayload"->'waTurnDelivery'->>'waDeliveryState') IS NULL
         OR ("rawPayload"->'waTurnDelivery'->>'waDeliveryState') NOT IN ('delivered', 'send_initiated')
         OR (
           ("rawPayload"->'waTurnDelivery'->>'waDeliveryState') = 'send_initiated'
           AND ("rawPayload"->'waTurnDelivery'->>'waOutboundProviderId') IS NULL
           AND (
             ("rawPayload"->'waTurnDelivery'->>'sendInitiatedAt') IS NULL
             OR (("rawPayload"->'waTurnDelivery'->>'sendInitiatedAt')::bigint < $3)
           )
         )
       )`,
      JSON.stringify(nextPayload),
      inboundMessageId,
      staleThreshold,
    );

    if (Number(updated) === 0) {
      const again = await tx.ticketMessage.findUnique({
        where: { id: inboundMessageId },
        select: { rawPayload: true },
      });
      if (!again) return { status: "lost_race" };
      const retryMeta = readDeliveryMeta(again.rawPayload);
      const retry = evaluateAcquireFromMeta(retryMeta);
      return retry ?? { status: "lost_race" };
    }

    return { status: "acquired", attemptId };
  });
}

/** Tras API OK: guarda provider id en inbound antes de marcar delivered (evita reenvío si falla persistencia). */
export async function recordInboundWaProviderAccepted(
  inboundMessageId: string,
  inboundDeliveryKey: string,
  attemptId: string,
  waOutboundProviderId: string,
  client: PrismaClient = prisma,
): Promise<boolean> {
  return client.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM "TicketMessage" WHERE id = ${inboundMessageId} FOR UPDATE`;
    const row = await tx.ticketMessage.findUnique({
      where: { id: inboundMessageId },
      select: { rawPayload: true },
    });
    if (!row) return false;
    const prior = priorPayloadObject(row.rawPayload);
    const meta = readDeliveryMeta(prior);
    const nextPayload = buildWaTurnDeliveryPatch(prior, {
      inboundDeliveryKey,
      waDeliveryState: "send_initiated",
      waOutboundProviderId,
      sendInitiatedAt: meta.sendInitiatedAt,
      attemptId,
    });
    const updated = await tx.$executeRawUnsafe(
      `UPDATE "TicketMessage"
       SET "rawPayload" = $1::jsonb
       WHERE id = $2
       AND ("rawPayload"->'waTurnDelivery'->>'attemptId') = $3
       AND ("rawPayload"->'waTurnDelivery'->>'waDeliveryState') = 'send_initiated'
       AND ("rawPayload"->'waTurnDelivery'->>'waOutboundProviderId') IS NULL`,
      JSON.stringify(nextPayload),
      inboundMessageId,
      attemptId,
    );
    return Number(updated) > 0;
  });
}

/**
 * Libera reserva solo si coincide attemptId y la API nunca devolvió provider id.
 * Fallo antes/durante POST sin aceptación → permite BBC fallback.
 */
export async function releaseInboundDeliverySendRight(
  inboundMessageId: string,
  inboundDeliveryKey: string,
  attemptId: string,
  client: PrismaClient = prisma,
): Promise<boolean> {
  return client.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM "TicketMessage" WHERE id = ${inboundMessageId} FOR UPDATE`;
    const row = await tx.ticketMessage.findUnique({
      where: { id: inboundMessageId },
      select: { rawPayload: true },
    });
    if (!row) return false;
    const prior = priorPayloadObject(row.rawPayload);
    const meta = readDeliveryMeta(prior);
    if (meta.waDeliveryState === "delivered" || meta.waOutboundProviderId) return false;
    const nextPayload = {
      ...prior,
      waTurnDelivery: {
        inboundDeliveryKey,
        waDeliveryState: "presaved",
      },
    };
    const updated = await tx.$executeRawUnsafe(
      `UPDATE "TicketMessage"
       SET "rawPayload" = $1::jsonb
       WHERE id = $2
       AND ("rawPayload"->'waTurnDelivery'->>'attemptId') = $3
       AND ("rawPayload"->'waTurnDelivery'->>'waDeliveryState') = 'send_initiated'
       AND ("rawPayload"->'waTurnDelivery'->>'waOutboundProviderId') IS NULL`,
      JSON.stringify(nextPayload),
      inboundMessageId,
      attemptId,
    );
    return Number(updated) > 0;
  });
}

export async function markInboundDeliveryDelivered(
  inboundMessageId: string,
  inboundDeliveryKey: string,
  waOutboundProviderId: string,
  attemptId: string,
  client: PrismaClient = prisma,
): Promise<boolean> {
  return client.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM "TicketMessage" WHERE id = ${inboundMessageId} FOR UPDATE`;
    const row = await tx.ticketMessage.findUnique({
      where: { id: inboundMessageId },
      select: { rawPayload: true },
    });
    if (!row) return false;
    const prior = priorPayloadObject(row.rawPayload);
    const nextPayload = buildWaTurnDeliveryPatch(prior, {
      inboundDeliveryKey,
      waDeliveryState: "delivered",
      waOutboundProviderId,
    });
    const updated = await tx.$executeRawUnsafe(
      `UPDATE "TicketMessage"
       SET "rawPayload" = $1::jsonb
       WHERE id = $2
       AND ("rawPayload"->'waTurnDelivery'->>'attemptId') = $3
       AND ("rawPayload"->'waTurnDelivery'->>'waDeliveryState') = 'send_initiated'`,
      JSON.stringify(nextPayload),
      inboundMessageId,
      attemptId,
    );
    return Number(updated) > 0;
  });
}

/**
 * Best-effort tras API OK: guarda provider id en inbound para bloquear reenvío
 * si falló record/mark (evita segundo POST en reintentos stale).
 */
export async function ensureInboundWaProviderIdStashed(
  inboundMessageId: string,
  inboundDeliveryKey: string,
  waOutboundProviderId: string,
  attemptId?: string,
  client: PrismaClient = prisma,
): Promise<void> {
  await client.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM "TicketMessage" WHERE id = ${inboundMessageId} FOR UPDATE`;
    const row = await tx.ticketMessage.findUnique({
      where: { id: inboundMessageId },
      select: { rawPayload: true },
    });
    if (!row) return;
    const prior = priorPayloadObject(row.rawPayload);
    const meta = readDeliveryMeta(prior);
    if (meta.waDeliveryState === "delivered" && meta.waOutboundProviderId) return;
    const nextPayload = buildWaTurnDeliveryPatch(prior, {
      inboundDeliveryKey,
      waDeliveryState: meta.waDeliveryState ?? "send_initiated",
      waOutboundProviderId,
      attemptId: meta.attemptId ?? attemptId,
      sendInitiatedAt: meta.sendInitiatedAt,
    });
    await tx.ticketMessage.update({
      where: { id: inboundMessageId },
      data: { rawPayload: nextPayload },
    });
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
