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
  | "hojas_de_ruta";

export type LastInfoGuideContext = {
  kind: LastInfoGuideKind;
  at: string;
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
  return { kind: src.kind, at };
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
    const next = {
      ...prev,
      lastInfoGuide: { kind, at: new Date().toISOString() } satisfies LastInfoGuideContext,
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
