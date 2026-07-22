import { looksLikeCustomerConversationCloseRequest } from "@/lib/customerConversationClose";
import { looksLikeOpenCaseStatusInquiry } from "@/lib/customerTicketInquiry";
import { detectIncidentType, detectLoosePlate } from "@/lib/wara";
import {
  looksLikeHumanAdvisorRequest,
  looksLikeMaintenanceInfoGuideInThread,
  looksLikeNonOdometerOperationalIntent,
  looksLikeOpcionesInfoRequest,
  looksLikeOperationalIntent,
  looksLikePlatformInfoGuideInThread,
  looksLikeUnidadesInfoRequest,
  shouldContinueOdometerFlow,
} from "@/lib/waraApi";
import { looksLikeUnitListRequest } from "@/lib/waraUnitIntent";

/** Ejecutores HTTP del backend (Fase 1). `bbc_router` = flujos informativos aún en BBC. */
export type TurnExecutorId =
  | "unidades"
  | "odometro"
  | "certificados"
  | "mantenimiento"
  | "odoo_ticket"
  | "bbc_router";

function norm(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function looksLikeCertificateIntent(text: string, threadText: string): boolean {
  if (looksLikeNonOdometerOperationalIntent(text) && /\b(certificado|cobertura|monitoreo|constancia)\b/.test(norm(text))) {
    return true;
  }
  const blob = norm(`${threadText}\n${text}`);
  return /\b(certificado|cobertura|constancia|monitoreo)\b/.test(blob);
}

function looksLikeOdometerIntent(text: string, threadText: string): boolean {
  return shouldContinueOdometerFlow(text, threadText);
}

function looksLikeMaintenanceOperational(text: string, threadText: string): boolean {
  const blob = norm(`${threadText}\n${text}`);
  if (looksLikeMaintenanceInfoGuideInThread(threadText) && !/\b(patente|matricula)\b/.test(blob)) {
    return false;
  }
  return /\b(mantenimiento|preventiv|correctiv|service|taller|reparaci[oó]n)\b/.test(blob);
}

function looksLikeBbcInfoGuide(text: string, threadText: string): boolean {
  if (looksLikeUnitListRequest(text)) return false;
  if (looksLikeOpcionesInfoRequest(text)) return true;
  if (looksLikeUnidadesInfoRequest(text) || looksLikeUnidadesInfoRequest(threadText)) return true;
  if (looksLikePlatformInfoGuideInThread(threadText)) return true;
  if (looksLikeMaintenanceInfoGuideInThread(threadText) && !looksLikeMaintenanceOperational(text, threadText)) {
    return true;
  }
  return false;
}

/**
 * Clasifica el ejecutor backend cuando Inicio/context devolvió `router`.
 * Prioridad alineada con sync-builderbot-router-wara.mjs (versión backend).
 */
export function classifyTurnExecutor(selectionText: string, threadText: string): TurnExecutorId {
  const text = selectionText.trim();
  const blob = `${threadText}\n${text}`;

  if (looksLikeUnitListRequest(text)) return "unidades";
  if (looksLikeCustomerConversationCloseRequest(text)) return "odoo_ticket";
  if (looksLikeOpenCaseStatusInquiry(text)) return "odoo_ticket";
  if (looksLikeHumanAdvisorRequest(text)) return "odoo_ticket";
  if (looksLikeBbcInfoGuide(text, threadText)) return "bbc_router";
  if (looksLikeCertificateIntent(text, threadText)) return "certificados";
  if (looksLikeOdometerIntent(text, threadText)) return "odometro";
  if (looksLikeMaintenanceOperational(text, threadText)) return "mantenimiento";

  if (
    detectLoosePlate(text) ||
    detectIncidentType(text) !== "OTHER" ||
    looksLikeOperationalIntent(text)
  ) {
    return "unidades";
  }

  if (/\b(reclamo|ticket|caso|problema|falla|aver[ií]a)\b/i.test(blob)) return "odoo_ticket";

  return "unidades";
}

export const TURN_EXECUTOR_PATH: Record<Exclude<TurnExecutorId, "bbc_router">, string> = {
  unidades: "/api/wara/unidades",
  odometro: "/api/wara/odometro-horometro",
  certificados: "/api/wara/certificados",
  mantenimiento: "/api/wara/mantenimiento-operativo",
  odoo_ticket: "/api/odoo/ticket",
};
