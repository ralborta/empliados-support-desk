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
): Promise<void> {
  const record: PendingActionRecord = {
    type,
    summary: opts?.summary,
    payload: opts?.payload,
    createdAt: new Date().toISOString(),
  };
  const normalized = normalizeWhatsAppPhone(phone);
  if (!normalized) return;
  await prisma.customer
    .update({
      where: { phone: normalized },
      data: { pendingAction: record as unknown as Prisma.InputJsonValue },
    })
    .catch(() => undefined);
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

/** Lee el trámite pendiente vigente (no vencido) para un teléfono, o null. */
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
