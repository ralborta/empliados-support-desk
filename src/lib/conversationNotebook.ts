import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { setActiveUnit, type ActiveUnitSource } from "@/lib/activeUnit";
import { normalizeWhatsAppPhone } from "@/lib/whatsappPhone";
import { looksLikeBriefConfirmation } from "@/lib/wara";

/**
 * Cuaderno interno de sesión — memoria conversacional estructurada (solo backend/IA).
 *
 * Rollback: WARA_CONVERSATION_NOTEBOOK=false (default) → no se lee ni escribe; el flujo
 * legacy (activeUnit + pendingAction + regex sobre hilo) sigue igual.
 *
 * Trámites: mantenimiento, odómetro/horómetro, certificado, consulta GPS/unidades.
 */

export function isConversationNotebookEnabled(): boolean {
  const raw = process.env.WARA_CONVERSATION_NOTEBOOK?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false;
  return raw === "1" || raw === "true" || raw === "yes" || raw === "si";
}

export type NotebookTramiteType =
  | "mantenimiento"
  | "odometro"
  | "horometro"
  | "certificado"
  | "consulta";

export type NotebookAwaiting =
  | "confirm_registro"
  | "confirm_offer"
  | "plate"
  | "detalle"
  | "odometro_value"
  | "horometro_value"
  | null;

export type SessionNotebook = {
  version: 1;
  companyName?: string;
  unitFocus?: {
    plate: string;
    label?: string;
    updatedAt: string;
  };
  intent?: NotebookTramiteType | null;
  tramite?: {
    type: NotebookTramiteType;
    service?: string;
    detalle?: string;
    priority?: string;
    plate?: string;
    odometro?: number;
    horometro?: number;
    fecha?: string;
  };
  awaiting?: NotebookAwaiting;
  suspended?: {
    type: NotebookTramiteType;
    tramite?: SessionNotebook["tramite"];
    unitFocus?: SessionNotebook["unitFocus"];
    at: string;
  };
  updatedAt: string;
};

/** Red de seguridad: sin mensajes recientes, el cuaderno se ignora (no TTL como lógica principal). */
export const SESSION_NOTEBOOK_IDLE_TTL_MS = 3 * 60 * 60 * 1000;

function inboundIsConfirmed(value: string | undefined | null): boolean {
  const t = String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return /^(confirmo|confirmar|si|s[ií]|dale|ok|okay|listo|de acuerdo|perfecto)$/.test(t);
}

function emptyNotebook(): SessionNotebook {
  return { version: 1, updatedAt: new Date().toISOString() };
}

function parseNotebook(raw: unknown): SessionNotebook | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.version !== 1 || typeof o.updatedAt !== "string") return null;
  return o as unknown as SessionNotebook;
}

function isNotebookFresh(record: SessionNotebook): boolean {
  const t = Date.parse(record.updatedAt);
  return Number.isFinite(t) && Date.now() - t <= SESSION_NOTEBOOK_IDLE_TTL_MS;
}

export async function getSessionNotebook(
  prisma: PrismaClient,
  phone: string,
): Promise<SessionNotebook | null> {
  if (!isConversationNotebookEnabled()) return null;
  const normalized = normalizeWhatsAppPhone(phone);
  if (!normalized) return null;
  const customer = await prisma.customer
    .findUnique({ where: { phone: normalized }, select: { sessionNotebook: true } })
    .catch(() => null);
  const record = parseNotebook(customer?.sessionNotebook);
  if (!record || !isNotebookFresh(record)) return null;
  return record;
}

export async function setSessionNotebook(
  prisma: PrismaClient,
  phone: string,
  notebook: SessionNotebook,
  opts?: { syncActiveUnit?: boolean; activeUnitSource?: ActiveUnitSource },
): Promise<void> {
  if (!isConversationNotebookEnabled()) return;
  const normalized = normalizeWhatsAppPhone(phone);
  if (!normalized) return;
  const next: SessionNotebook = {
    ...notebook,
    version: 1,
    updatedAt: new Date().toISOString(),
  };
  await prisma.customer
    .update({
      where: { phone: normalized },
      data: { sessionNotebook: next as unknown as Prisma.InputJsonValue },
    })
    .catch(() => undefined);

  if (opts?.syncActiveUnit !== false && next.unitFocus?.plate) {
    await setActiveUnit(prisma, phone, next.unitFocus.plate, {
      label: next.unitFocus.label,
      source: opts?.activeUnitSource ?? "mantenimiento",
    });
  }
}

export async function patchSessionNotebook(
  prisma: PrismaClient,
  phone: string,
  patch: Partial<Omit<SessionNotebook, "version">>,
  opts?: { syncActiveUnit?: boolean; activeUnitSource?: ActiveUnitSource; supersede?: boolean },
): Promise<SessionNotebook> {
  const current = (await getSessionNotebook(prisma, phone)) ?? emptyNotebook();
  let base = current;

  if (opts?.supersede && patch.intent && current.intent && patch.intent !== current.intent) {
    base = {
      ...current,
      suspended: {
        type: current.intent,
        tramite: current.tramite,
        unitFocus: current.unitFocus,
        at: new Date().toISOString(),
      },
    };
  }

  const merged: SessionNotebook = {
    ...base,
    ...patch,
    unitFocus: patch.unitFocus ?? base.unitFocus,
    tramite: patch.tramite
      ? { ...base.tramite, ...patch.tramite }
      : base.tramite,
    version: 1,
    updatedAt: new Date().toISOString(),
  };

  await setSessionNotebook(prisma, phone, merged, opts);
  return merged;
}

export async function clearSessionNotebook(prisma: PrismaClient, phone: string): Promise<void> {
  if (!isConversationNotebookEnabled()) return;
  const normalized = normalizeWhatsAppPhone(phone);
  if (!normalized) return;
  await prisma.customer
    .update({
      where: { phone: normalized },
      data: { sessionNotebook: Prisma.JsonNull },
    })
    .catch(() => undefined);
}

/** Reemplaza unidad en foco cuando hay patente explícita nueva. */
export function shouldReplaceUnitFocus(explicitPlate: string | null | undefined): boolean {
  return !!explicitPlate?.trim();
}

/** Patente de contexto: cuaderno (más reciente) → unidad activa legacy. */
export function resolveContextUnitPlate(params: {
  sessionNotebook?: SessionNotebook | null;
  activeUnitPlate?: string | null;
}): string | null {
  const fromNotebook = params.sessionNotebook?.unitFocus?.plate
    ?.replace(/\s+/g, "")
    .toUpperCase()
    .trim();
  if (fromNotebook) return fromNotebook;
  const active = params.activeUnitPlate?.replace(/\s+/g, "").toUpperCase().trim();
  return active || null;
}

/** Trámite de medidor en curso (odómetro vs horómetro). */
export function resolveMeterNotebookType(params: {
  horometerFlowActive: boolean;
  horometerOnlyIntent?: boolean;
}): "odometro" | "horometro" {
  return params.horometerFlowActive || params.horometerOnlyIntent ? "horometro" : "odometro";
}

/** El cuaderno indica que el cliente está en flujo de horómetro (horas, no km). */
export function notebookIndicatesHorometerFlow(
  sessionNotebook: SessionNotebook | null | undefined,
): boolean {
  if (!sessionNotebook) return false;
  return (
    sessionNotebook.intent === "horometro" ||
    sessionNotebook.tramite?.type === "horometro" ||
    sessionNotebook.awaiting === "horometro_value"
  );
}

/**
 * Texto de detalle del trámite de mantenimiento — nunca usar "Si"/"dale" como detalle.
 * Aplica siempre (con o sin cuaderno) como red de seguridad mínima.
 */
export function resolveMaintenanceDetailText(params: {
  inboundText: string;
  service: string;
  plate?: string | null;
  summaryDetalle?: string;
  notebookDetalle?: string;
}): string {
  const raw = params.inboundText.trim();
  const fallback =
    params.notebookDetalle ||
    params.summaryDetalle ||
    (params.plate
      ? `${params.service} para ${params.plate.replace(/\s+/g, "").toUpperCase()}`
      : params.service) ||
    "Solicitud de gestión de mantenimiento";

  if (!raw) return fallback;
  if (looksLikeBriefConfirmation(raw) || inboundIsConfirmed(raw)) return fallback;
  if (/^(preventiv\w*|correctiv\w*|plan de mantenimiento)$/i.test(raw)) {
    return params.plate
      ? `${params.service} para ${params.plate.replace(/\s+/g, "").toUpperCase()}`
      : params.service;
  }
  return raw;
}

/** ¿El inbound es afirmación para avanzar con mantenimiento ya ofrecido en el hilo? */
export function isMaintenanceAffirmationWithoutFormalSummary(params: {
  inboundText: string;
  pendingFormalConfirm: boolean;
  hasPlateContext: boolean;
  threadText: string;
}): boolean {
  if (params.pendingFormalConfirm) return false;
  const inbound = params.inboundText.trim();
  if (!looksLikeBriefConfirmation(inbound) && !inboundIsConfirmed(inbound)) return false;
  if (!params.hasPlateContext) return false;
  const tail = params.threadText.slice(-2000).toLowerCase();
  return (
    /mantenimiento/.test(tail) &&
    (/preventiv|correctiv|plan de mantenimiento/.test(tail) ||
      /quer[eé]s que (avance|registre|proceda)/.test(tail) ||
      /(?:avanzo|registro|procedo) con/.test(tail) ||
      /para (?:esa|la) unidad/.test(tail))
  );
}
