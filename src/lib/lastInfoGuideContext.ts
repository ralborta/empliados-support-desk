/**
 * Último guideKind de info_guides (metadato estructurado para retoma idle).
 * Vive en Customer.sessionNotebook.lastInfoGuide — independiente del flag
 * WARA_CONVERSATION_NOTEBOOK (no requiere el cuaderno conversacional completo).
 */
import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { normalizeWhatsAppPhone } from "@/lib/whatsappPhone";

export type LastInfoGuideKind =
  | "transporte_publico"
  | "mantenimiento"
  | "opciones"
  | "unidades"
  | "cisternas"
  | "combustible"
  | "hojas_de_ruta"
  | "puntos_de_interes"
  | "utilidades_bloque_2"
  | "informes"
  | "alertas";

export type LastInfoGuideContext = {
  kind: LastInfoGuideKind;
  at: string;
  /** Solo familia informes: categoría activa para continuidad. */
  category?: string | null;
  /** Informes: pantalla; Alertas: itemId / al-* (alias de continuidad). */
  reportId?: string | null;
  articleIds?: string[];
};

export type LastInfoGuideMeta = {
  category?: string | null;
  reportId?: string | null;
  articleIds?: string[];
};

/** Misma ventana que notebook idle — no retomar guía de hace días. */
export const LAST_INFO_GUIDE_TTL_MS = 3 * 60 * 60 * 1000;

const ALLOWED = new Set<string>([
  "transporte_publico",
  "mantenimiento",
  "opciones",
  "unidades",
  "cisternas",
  "combustible",
  "hojas_de_ruta",
  "puntos_de_interes",
  "utilidades_bloque_2",
  "informes",
  "alertas",
]);

export function isLastInfoGuideKind(value: unknown): value is LastInfoGuideKind {
  return typeof value === "string" && ALLOWED.has(value);
}

export function parseLastInfoGuideContext(raw: unknown): LastInfoGuideContext | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  const nested = rec.lastInfoGuide;
  const src =
    nested && typeof nested === "object"
      ? (nested as Record<string, unknown>)
      : rec.kind
        ? rec
        : null;
  if (!src) return null;
  if (!isLastInfoGuideKind(src.kind)) return null;
  const at = typeof src.at === "string" ? src.at : "";
  const t = Date.parse(at);
  if (!Number.isFinite(t) || Date.now() - t > LAST_INFO_GUIDE_TTL_MS) return null;
  const category =
    typeof src.category === "string"
      ? src.category
      : src.category === null
        ? null
        : undefined;
  const reportId =
    typeof src.reportId === "string"
      ? src.reportId
      : src.reportId === null
        ? null
        : undefined;
  const articleIds = Array.isArray(src.articleIds)
    ? src.articleIds.map((id) => String(id).trim()).filter(Boolean).slice(0, 8)
    : undefined;
  return {
    kind: src.kind,
    at,
    ...(category !== undefined ? { category } : {}),
    ...(reportId !== undefined ? { reportId } : {}),
    ...(articleIds !== undefined ? { articleIds } : {}),
  };
}

export async function getLastInfoGuideContext(
  prisma: PrismaClient,
  phone: string,
): Promise<LastInfoGuideContext | null> {
  const normalized = normalizeWhatsAppPhone(phone);
  if (!normalized) return null;
  const customer = await prisma.customer
    .findUnique({ where: { phone: normalized }, select: { sessionNotebook: true } })
    .catch(() => null);
  return parseLastInfoGuideContext(customer?.sessionNotebook);
}

export async function setLastInfoGuideContext(
  prisma: PrismaClient,
  phone: string,
  kind: LastInfoGuideKind,
  meta?: LastInfoGuideMeta,
): Promise<boolean> {
  const normalized = normalizeWhatsAppPhone(phone);
  if (!normalized || !isLastInfoGuideKind(kind)) return false;
  try {
    const customer = await prisma.customer.findUnique({
      where: { phone: normalized },
      select: { sessionNotebook: true },
    });
    const prev =
      customer?.sessionNotebook && typeof customer.sessionNotebook === "object"
        ? ({ ...(customer.sessionNotebook as Record<string, unknown>) } as Record<string, unknown>)
        : {};
    const lastInfoGuide: LastInfoGuideContext = {
      kind,
      at: new Date().toISOString(),
    };
    if (meta) {
      if (meta.category !== undefined) lastInfoGuide.category = meta.category;
      if (meta.reportId !== undefined) lastInfoGuide.reportId = meta.reportId;
      if (meta.articleIds !== undefined) {
        lastInfoGuide.articleIds = meta.articleIds
          .map((id) => String(id).trim())
          .filter(Boolean)
          .slice(0, 8);
      }
    }
    const next = {
      ...prev,
      lastInfoGuide,
    };
    await prisma.customer.update({
      where: { phone: normalized },
      data: { sessionNotebook: next as unknown as Prisma.InputJsonValue },
    });
    return true;
  } catch (err) {
    console.error("[lastInfoGuideContext] set failed", {
      phone: normalized,
      kind,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
