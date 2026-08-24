import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { normalizeWhatsAppPhone } from "@/lib/whatsappPhone";

/**
 * Estado explícito de trámite pendiente de confirmación — reemplaza (con fallback)
 * la inferencia por regex sobre el texto del hilo (`hasPendingXConfirmation` en wara.ts).
 *
 * Se guarda en `Customer.pendingAction` (columna JSONB nullable, migración
 * 20260722225859_add_customer_pending_action). Null = sin trámite pendiente.
 *
 * Diseño intencionalmente conservador: es una capa adicional de lectura prioritaria,
 * no un reemplazo total. Si no hay pendingAction en DB (conversación vieja, o algún
 * ejecutor que todavía no lo escribe), el sistema sigue funcionando con los regex
 * existentes (`resolvePendingConfirmationExecutor`) exactamente como antes.
 */

export type PendingActionType = "certificados" | "odometro" | "mantenimiento";

export type PendingActionRecord = {
  type: PendingActionType;
  /** Texto exacto del resumen mostrado al cliente (para trazabilidad/debug). */
  summary?: string;
  /** Datos del trámite (patente, odómetro, servicio, etc.) — forma libre por tipo. */
  payload?: Record<string, unknown>;
  createdAt: string;
};

/** Vencimiento de un trámite pendiente: pasado este tiempo, se ignora (evita reabrir algo viejo). */
const PENDING_ACTION_TTL_MS = 45 * 60 * 1000;

export async function setPendingAction(
  prisma: PrismaClient,
  phone: string,
  type: PendingActionType,
  opts?: { summary?: string; payload?: Record<string, unknown> },
): Promise<boolean> {
  const record: PendingActionRecord = {
    type,
    summary: opts?.summary,
    payload: opts?.payload,
    createdAt: new Date().toISOString(),
  };
  const normalized = normalizeWhatsAppPhone(phone);
  if (!normalized) return false;
  try {
    await prisma.customer.update({
      where: { phone: normalized },
      data: { pendingAction: record as unknown as Prisma.InputJsonValue },
    });
    return true;
  } catch (err) {
    console.error("[pendingAction] setPendingAction failed", {
      phone: normalized,
      type,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

export async function clearPendingAction(prisma: PrismaClient, phone: string): Promise<void> {
  const normalized = normalizeWhatsAppPhone(phone);
  if (!normalized) return;
  await prisma.customer
    .update({
      where: { phone: normalized },
      data: { pendingAction: Prisma.JsonNull },
    })
    .catch(() => undefined);
}

export async function getPendingAction(
  prisma: PrismaClient,
  phone: string,
): Promise<PendingActionRecord | null> {
  const normalized = normalizeWhatsAppPhone(phone);
  if (!normalized) return null;
  const customer = await prisma.customer
    .findUnique({ where: { phone: normalized }, select: { pendingAction: true } })
    .catch(() => null);
  const raw = customer?.pendingAction;
  if (!raw || typeof raw !== "object") return null;
  const record = raw as unknown as PendingActionRecord;
  if (!record.type || !record.createdAt) return null;
  const createdAt = Date.parse(record.createdAt);
  if (!Number.isFinite(createdAt) || Date.now() - createdAt > PENDING_ACTION_TTL_MS) {
    return null;
  }
  return record;
}

/** Fusiona campos en `payload` sin perder el trámite vigente.
 * @returns true si se persistió; false si no hay pending o falló el write.
 */
export async function patchPendingActionPayload(
  prisma: PrismaClient,
  phone: string,
  payloadPatch: Record<string, unknown>,
): Promise<boolean> {
  const current = await getPendingAction(prisma, phone);
  if (!current) return false;
  const prevPayload = (current.payload ?? {}) as Record<string, unknown>;
  const patchTurn = payloadPatch.turnLayer;
  const mergedPayload: Record<string, unknown> = {
    ...prevPayload,
    ...payloadPatch,
  };
  if (patchTurn && typeof patchTurn === "object") {
    mergedPayload.turnLayer = {
      ...((prevPayload.turnLayer as Record<string, unknown>) ?? {}),
      ...(patchTurn as Record<string, unknown>),
    };
  }
  return setPendingAction(prisma, phone, current.type, {
    summary: current.summary,
    payload: mergedPayload,
  });
}

/** Shell de recolección + turnLayer (bifurcación lateral) sin resumen CONFIRMO. */
export async function ensureOdometerCollectingTurnLayer(
  prisma: PrismaClient,
  phone: string,
  threadText: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const current = await getPendingAction(prisma, phone);
  if (current?.type === "odometro") {
    await patchPendingActionPayload(prisma, phone, payload);
    return;
  }
  await setPendingAction(prisma, phone, "odometro", {
    payload,
  });
}
