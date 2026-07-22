import { looksLikeCustomerConversationCloseRequest } from "@/lib/customerConversationClose";
import { looksLikeOpenCaseStatusInquiry } from "@/lib/customerTicketInquiry";
import { resolvePendingConfirmationExecutor } from "@/lib/pendingConfirmation";
import {
  certificateFlowState,
  detectIncidentType,
  detectLoosePlate,
  hasPendingCertificateConfirmation,
  extractPlatePrefixFromMessage,
  hasPendingMaintenancePlateRequest,
  hasPendingMantenimientoConfirmation,
  hasPendingOdometerConfirmation,
  isBarePlatePrefixHint,
  isMaintenanceFlowSuperseded,
  isOdometerFlowSuperseded,
  looksLikeBriefConfirmation,
  looksLikePostAdvisorCaseThread,
  looksLikeCertificateUnitReply,
  threadAwaitingOdometerPlate,
} from "@/lib/wara";
import {
  looksLikeConversationAcknowledgement,
  looksLikeExplicitReclamoOrTicketRequest,
  looksLikeGpsOrUnitStatusQuestion,
  looksLikeHumanAdvisorRequest,
  looksLikeMaintenanceCapabilityQuestion,
  looksLikeSubstantiveCustomerMessage,
  looksLikeMaintenanceGuideContextInThread,
  looksLikeMaintenanceInfoGuideInThread,
  looksLikeMaintenanceInfoRequest,
  looksLikeNonOdometerOperationalIntent,
  looksLikeOperationalMaintenanceIntent,
  looksLikeOpcionesInfoRequest,
  looksLikeOperationalIntent,
  looksLikePlateCorrectionRequest,
  looksLikePlatformInfoGuideInThread,
  looksLikeUnidadesInfoRequest,
  looksLikeVehicleBrandOrUnitSearch,
  shouldContinueOdometerFlow,
} from "@/lib/waraApi";
import { looksLikeUnitListRequest, isMaintenancePlateSelectionMessage } from "@/lib/waraUnitIntent";

/** Ejecutores HTTP del backend (Fase 1 completa — sin BBC Router GPT). */
export type TurnExecutorId =
  | "unidades"
  | "odometro"
  | "certificados"
  | "mantenimiento"
  | "odoo_ticket"
  | "info_guides";

function norm(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function looksLikeCertificateIntent(text: string, threadText: string): boolean {
  const nText = norm(text);
  if (
    looksLikeNonOdometerOperationalIntent(text) &&
    /\b(certificado|cobertura|monitoreo|constancia)\b/.test(nText)
  ) {
    return true;
  }
  if (
    /\b(certificado|cobertura|constancia|monitoreo|reenvi\w*\s+certificado|certificado\s+nuevo)\b/.test(
      nText,
    )
  ) {
    return true;
  }
  // El hilo solo cuenta mientras el trámite de certificado sigue activo (unidad o confirmación).
  return certificateFlowState(threadText) !== "none";
}

function looksLikeOdometerIntent(text: string, threadText: string): boolean {
  if (isOdometerFlowSuperseded(threadText)) return false;
  return shouldContinueOdometerFlow(text, threadText);
}

function looksLikeMaintenanceOperational(text: string, threadText: string): boolean {
  if (isMaintenanceFlowSuperseded(threadText, text)) return false;
  if (looksLikeGpsOrUnitStatusQuestion(text)) return false;
  const incident = detectIncidentType(text);
  if (
    incident !== "OTHER" &&
    !/\b(mantenimiento|preventiv|correctiv|tarea|plan|service|taller|reparacion)\b/.test(norm(text))
  ) {
    return false;
  }
  if (looksLikeOperationalMaintenanceIntent(text, threadText)) return true;
  if (looksLikeMaintenanceCapabilityQuestion(text, threadText)) return true;
  if (looksLikeMaintenanceInfoRequest(text)) return false;
  // Prefijo o patente suelta: no arrastrar "mantenimiento" del hilo (evita skip silencioso).
  if (isUnitSelectionMessage(text) && !/\b(mantenimiento|preventiv|correctiv)\b/.test(norm(text))) {
    return false;
  }
  const blob = norm(`${threadText}\n${text}`);
  if (
    looksLikeMaintenanceGuideContextInThread(threadText) &&
    !/\b(patente|matricula)\b/.test(blob) &&
    !looksLikeMaintenanceCapabilityQuestion(text, threadText)
  ) {
    return false;
  }
  if (!/\b(mantenimiento|preventiv|correctiv|service|taller|reparacion)\b/.test(norm(text))) {
    return false;
  }
  return /\b(mantenimiento|preventiv|correctiv|service|taller|reparaci[oó]n)\b/.test(blob);
}

function looksLikeBbcInfoGuide(text: string, threadText: string): boolean {
  if (looksLikeUnitListRequest(text)) return false;
  if (hasPendingMaintenancePlateRequest(threadText) && isUnitSelectionMessage(text)) return false;
  if (isUnitSelectionMessage(text) && looksLikeMaintenanceGuideContextInThread(threadText)) {
    return false;
  }
  if (looksLikeOperationalMaintenanceIntent(text, threadText)) return false;
  if (looksLikeMaintenanceCapabilityQuestion(text, threadText)) return false;
  if (looksLikeOpcionesInfoRequest(text)) return true;
  if (looksLikeMaintenanceInfoRequest(text)) return true;
  if (looksLikeUnidadesInfoRequest(text) || looksLikeUnidadesInfoRequest(threadText)) return true;
  if (looksLikePlatformInfoGuideInThread(threadText)) return true;
  if (looksLikeMaintenanceInfoGuideInThread(threadText) && !looksLikeMaintenanceOperational(text, threadText)) {
    return true;
  }
  if (looksLikeMaintenanceGuideContextInThread(threadText) && !looksLikeMaintenanceOperational(text, threadText)) {
    return true;
  }
  return false;
}

function isCertificateUnitContext(threadText: string): boolean {
  return certificateFlowState(threadText) === "awaiting_unit";
}

function isUnitSelectionMessage(text: string): boolean {
  return (
    !!detectLoosePlate(text) ||
    isBarePlatePrefixHint(text) ||
    !!extractPlatePrefixFromMessage(text) ||
    isMaintenancePlateSelectionMessage(text) ||
    looksLikeCertificateUnitReply(text) ||
    looksLikeVehicleBrandOrUnitSearch(text) ||
    looksLikePlateCorrectionRequest(text)
  );
}

/**
 * Clasifica el ejecutor backend (Fase 1 — cerebro único).
 * Prioridad alineada con sync-builderbot-router-wara.mjs.
 */
export function classifyTurnExecutor(selectionText: string, threadText: string): TurnExecutorId {
  const text = selectionText.trim();

  if (looksLikeUnitListRequest(text)) return "unidades";
  if (looksLikeCustomerConversationCloseRequest(text)) return "odoo_ticket";
  if (looksLikeOpenCaseStatusInquiry(text)) return "odoo_ticket";
  if (looksLikeHumanAdvisorRequest(text)) return "odoo_ticket";
  if (looksLikeExplicitReclamoOrTicketRequest(text)) return "odoo_ticket";

  // Patente/prefijo tras pedido de mantenimiento — ANTES que guías informativas.
  if (hasPendingMaintenancePlateRequest(threadText) && isUnitSelectionMessage(text)) {
    return "mantenimiento";
  }

  // Guías informativas → backend (Opciones, Unidades, Mantenimiento informativo)
  if (looksLikeBbcInfoGuide(text, threadText)) return "info_guides";

  // Confirmaciones pendientes — resolver único (cert → odo → maint)
  const pendingConfirmExecutor = resolvePendingConfirmationExecutor(threadText, text);
  if (pendingConfirmExecutor) return pendingConfirmExecutor;
  if (
    hasPendingMantenimientoConfirmation(threadText) &&
    looksLikeSubstantiveCustomerMessage(text) &&
    !looksLikeBriefConfirmation(text)
  ) {
    if (looksLikeGpsOrUnitStatusQuestion(text) || detectIncidentType(text) !== "OTHER") {
      return "unidades";
    }
  }

  // Tras caso/asesor informado: no re-abrir Odoo por "confirmo"/"dale"/"gracias" ni por palabras del hilo.
  if (
    looksLikePostAdvisorCaseThread(threadText) &&
    (looksLikeConversationAcknowledgement(text) ||
      (looksLikeBriefConfirmation(text) &&
        !hasPendingCertificateConfirmation(threadText) &&
        !hasPendingOdometerConfirmation(threadText) &&
        !hasPendingMantenimientoConfirmation(threadText)))
  ) {
    return "unidades";
  }

  // Certificado: pedido explícito o respuesta de unidad tras "necesito la unidad"
  if (looksLikeCertificateIntent(text, threadText)) return "certificados";
  if (isCertificateUnitContext(threadText) && isUnitSelectionMessage(text)) {
    return "certificados";
  }

  // Mantenimiento: patente pedida en contexto de mantenimiento (también cubierto arriba; redundante por claridad)
  if (hasPendingMaintenancePlateRequest(threadText) && isUnitSelectionMessage(text)) {
    return "mantenimiento";
  }

  // Odómetro: corrección de patente o continuación del trámite
  if (
    !isOdometerFlowSuperseded(threadText) &&
    (looksLikeOdometerIntent(text, threadText) ||
      (threadAwaitingOdometerPlate(threadText) && isUnitSelectionMessage(text)) ||
      (looksLikePlateCorrectionRequest(text) && /od[oó]metro|hor[oó]metro|kilometraje/.test(norm(threadText))))
  ) {
    return "odometro";
  }

  if (looksLikeMaintenanceOperational(text, threadText)) return "mantenimiento";

  const incident = detectIncidentType(text);
  if (incident === "ADMIN_DERIVATION" || incident === "ACCESS_PLATFORM") {
    return "odoo_ticket";
  }

  if (
    detectLoosePlate(text) ||
    isBarePlatePrefixHint(text) ||
    incident !== "OTHER" ||
    looksLikeOperationalIntent(text)
  ) {
    return "unidades";
  }

  if (/\b(reclamo|ticket|caso|problema|falla|aver[ií]a)\b/i.test(text)) return "odoo_ticket";

  return "unidades";
}

export const TURN_EXECUTOR_PATH: Record<TurnExecutorId, string> = {
  unidades: "/api/wara/unidades",
  odometro: "/api/wara/odometro-horometro",
  certificados: "/api/wara/certificados",
  mantenimiento: "/api/wara/mantenimiento-operativo",
  odoo_ticket: "/api/odoo/ticket",
  info_guides: "/api/wara/info-guides",
};
