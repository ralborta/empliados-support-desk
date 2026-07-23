import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { normalizeWhatsAppPhone } from "@/lib/whatsappPhone";
import { looksLikePlateCorrectionRequest } from "@/lib/waraApi";
import { looksLikeFleetUnitSearchInput } from "@/lib/waraUnitIntent";
import { looksLikeUnitRejection } from "@/lib/wara";

/**
 * Estado explícito de "unidad activa" — de qué unidad de la flota está hablando la
 * conversación en este momento. Reemplaza (con fallback) la inferencia por regex
 * sobre el texto del hilo (`extractLastPlateFromThread`, `looksLikeVagueUnitReference`
 * en @/lib/wara y @/lib/waraUnitIntent).
 *
 * Por qué hace falta esta capa (auditoría 2026-07-23): la inferencia por regex solo
 * reconoce un catálogo cerrado de frases ("esa unidad", "la unidad mencionada", "esa",
 * "el mismo"...). Cualquier forma de referirse a la unidad ya resuelta que no esté en
 * ese catálogo — "también" ("dame el certificado también"), una pregunta meta ("qué
 * unidad estamos consultando?"), o simplemente ningún texto que la nombre — hace que
 * el bot pierda el contexto y vuelva a pedir la patente, incluso segundos después de
 * haberla resuelto. Guardar la última unidad resuelta explícitamente en DB (en vez de
 * tratar de adivinarla de nuevo cada vez a partir del texto crudo) es la forma robusta
 * de resolver esto de raíz, no reactiva parche por parche cada frase nueva que aparezca.
 *
 * Se guarda en `Customer.activeUnit` (columna JSONB nullable, migración
 * 20260723064500_add_customer_active_unit). Null = sin unidad activa.
 *
 * Diseño intencionalmente conservador, igual que @/lib/pendingAction: es una capa
 * adicional de lectura de RESPALDO (se usa solo cuando el mensaje actual y el texto
 * del hilo no traen ninguna señal explícita de patente/marca/prefijo), no un
 * reemplazo total de la resolución existente. Si no hay activeUnit en DB (conversación
 * vieja, cliente sin ninguna unidad resuelta todavía), el sistema sigue funcionando
 * exactamente como antes.
 */

export type ActiveUnitSource = "estado" | "certificado" | "odometro" | "mantenimiento";

export type ActiveUnitRecord = {
  /** Patente normalizada, sin espacios, mayúsculas (ej. "AG562SP"). */
  plate: string;
  /** Etiqueta legible para mostrar en respuestas (ej. "AG 562 SP (NISSAN 2404)"). */
  label?: string;
  /** Trámite en el que se resolvió por última vez esta unidad. */
  source: ActiveUnitSource;
  resolvedAt: string;
};

/** Vencimiento de la unidad activa: pasado este tiempo, se ignora (evita reusar algo viejo). */
const ACTIVE_UNIT_TTL_MS = 45 * 60 * 1000;

/** Puro, testeable sin DB: la unidad activa sigue vigente (no vencida) en `now`. */
export function isActiveUnitFresh(record: Pick<ActiveUnitRecord, "resolvedAt">, now = Date.now()): boolean {
  const resolvedAt = Date.parse(record.resolvedAt);
  return Number.isFinite(resolvedAt) && now - resolvedAt <= ACTIVE_UNIT_TTL_MS;
}

/**
 * Puro, testeable sin DB: ¿corresponde usar la unidad activa como respaldo para ESTE
 * mensaje? Solo cuando el mensaje no trae ninguna señal propia de patente/marca/prefijo
 * (`looksLikeFleetUnitSearchInput`) ni es una corrección explícita de patente — en
 * cualquiera de esos dos casos, el cliente está señalando una unidad concreta (la misma
 * u otra distinta) y no corresponde pisarla con la unidad activa guardada.
 *
 * Tampoco corresponde cuando el cliente RECHAZA explícitamente la unidad activa
 * (`looksLikeUnitRejection`, ej. "no quiero ver esa, es otra") aunque no diga cuál es
 * la alternativa — bug real, producción 2026-07-23: sin este chequeo, cualquier mensaje
 * de rechazo sin marca nueva volvía a devolver la MISMA unidad recién rechazada (loop).
 */
export function shouldUseActiveUnitFallback(rawText: string): boolean {
  return (
    !looksLikeFleetUnitSearchInput(rawText) &&
    !looksLikePlateCorrectionRequest(rawText) &&
    !looksLikeUnitRejection(rawText)
  );
}

export async function setActiveUnit(
  prisma: PrismaClient,
  phone: string,
  plate: string,
  opts?: { label?: string; source?: ActiveUnitSource },
): Promise<void> {
  const normalizedPlate = plate.replace(/\s+/g, "").toUpperCase();
  if (!normalizedPlate) return;
  const normalized = normalizeWhatsAppPhone(phone);
  if (!normalized) return;
  const record: ActiveUnitRecord = {
    plate: normalizedPlate,
    label: opts?.label,
    source: opts?.source ?? "estado",
    resolvedAt: new Date().toISOString(),
  };
  await prisma.customer
    .update({
      where: { phone: normalized },
      data: { activeUnit: record as unknown as Prisma.InputJsonValue },
    })
    .catch(() => undefined);
}

export async function clearActiveUnit(prisma: PrismaClient, phone: string): Promise<void> {
  const normalized = normalizeWhatsAppPhone(phone);
  if (!normalized) return;
  await prisma.customer
    .update({
      where: { phone: normalized },
      data: { activeUnit: Prisma.JsonNull },
    })
    .catch(() => undefined);
}

/** Lee la unidad activa vigente (no vencida) para un teléfono, o null. */
export async function getActiveUnit(
  prisma: PrismaClient,
  phone: string,
): Promise<ActiveUnitRecord | null> {
  const normalized = normalizeWhatsAppPhone(phone);
  if (!normalized) return null;
  const customer = await prisma.customer
    .findUnique({ where: { phone: normalized }, select: { activeUnit: true } })
    .catch(() => null);
  const raw = customer?.activeUnit;
  if (!raw || typeof raw !== "object") return null;
  const record = raw as unknown as ActiveUnitRecord;
  if (!record.plate || !record.resolvedAt) return null;
  if (!isActiveUnitFresh(record)) return null;
  return record;
}
