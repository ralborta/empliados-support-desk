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
  looksLikeExplicitOdometerUpdateRequest,
  looksLikeOdometerProblemReport,
  looksLikePostAdvisorCaseThread,
  looksLikeCertificateUnitReply,
  threadAwaitingOdometerPlate,
  threadHasActiveOdometerFlow,
} from "@/lib/wara";
import {
  looksLikeConversationAcknowledgement,
  looksLikeExplicitReclamoOrTicketRequest,
  looksLikeFlowControlCommand,
  looksLikeGpsOrUnitStatusQuestion,
  looksLikeHumanAdvisorRequest,
  looksLikeLiveUnitConsultIntent,
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
  looksLikeInfoGuideModulePick,
  looksLikeTechnicalSupportRequest,
  threadHasGenericPlatformMenuOffer,
  shouldContinueOdometerFlow,
  threadHasRecentLiveUnitConsultIntent,
} from "@/lib/waraApi";
import { looksLikeUnitListRequest, isMaintenancePlateSelectionMessage, looksLikeFleetUnitSearchInput } from "@/lib/waraUnitIntent";
import { detectInfoGuideKind } from "@/lib/infoGuideReplies";

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
  if (looksLikeOdometerProblemReport(text)) return false;
  if (looksLikeExplicitOdometerUpdateRequest(text)) return true;
  if (isOdometerFlowSuperseded(threadText)) return false;
  return shouldContinueOdometerFlow(text, threadText);
}

function looksLikeMaintenanceOperational(text: string, threadText: string): boolean {
  if (isMaintenanceFlowSuperseded(threadText, text)) return false;
  if (looksLikeGpsOrUnitStatusQuestion(text)) return false;
  const incident = detectIncidentType(text);
  if (
    incident !== "OTHER" &&
    !/\b(mantenimiento|preventiv\w*|correctiv\w*|tarea|plan|service|taller|reparacion)\b/.test(norm(text))
  ) {
    return false;
  }
  if (looksLikeOperationalMaintenanceIntent(text, threadText)) return true;
  if (looksLikeMaintenanceCapabilityQuestion(text, threadText)) return true;
  if (looksLikeMaintenanceInfoRequest(text)) return false;
  // Prefijo o patente suelta: no arrastrar "mantenimiento" del hilo (evita skip silencioso).
  if (isUnitSelectionMessage(text, threadText) && !/\b(mantenimiento|preventiv\w*|correctiv\w*)\b/.test(norm(text))) {
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
  if (!/\b(mantenimiento|preventiv\w*|correctiv\w*|service|taller|reparacion)\b/.test(norm(text))) {
    return false;
  }
  return /\b(mantenimiento|preventiv\w*|correctiv\w*|service|taller|reparaci[oó]n)\b/.test(blob);
}

function isCertificateUnitContext(threadText: string): boolean {
  return certificateFlowState(threadText) === "awaiting_unit";
}

function isUnitSelectionMessage(text: string, threadText = ""): boolean {
  return (
    !!detectLoosePlate(text) ||
    isBarePlatePrefixHint(text) ||
    !!extractPlatePrefixFromMessage(text) ||
    isMaintenancePlateSelectionMessage(text) ||
    looksLikeCertificateUnitReply(text, threadText) ||
    looksLikeVehicleBrandOrUnitSearch(text) ||
    looksLikePlateCorrectionRequest(text)
  );
}

/* -------------------------------------------------------------------------- */
/* Tabla de reglas — looksLikeBbcInfoGuide                                    */
/* -------------------------------------------------------------------------- */
/**
 * Cada regla se evalúa en orden. `decide` devuelve:
 *   - `true`/`false`: verdicto definitivo, se detiene la evaluación (igual que un `return` temprano).
 *   - `undefined`: esta regla no aplica, seguir con la siguiente.
 * Esto es una transformación 1:1 del cascade de `if` anterior — mismo orden, misma condición
 * por rama — para que agregar/mover una regla sea explícito y no requiera releer todo el cuerpo.
 */
type InfoGuideRuleContext = { text: string; threadText: string };
type InfoGuideRule = {
  id: string;
  reason: string;
  decide: (ctx: InfoGuideRuleContext) => boolean | undefined;
};

const INFO_GUIDE_RULES: InfoGuideRule[] = [
  {
    id: "unit_list_block",
    reason: "Pedido de listado de unidades tiene prioridad — no es guía informativa.",
    decide: ({ text }) => (looksLikeUnitListRequest(text) ? false : undefined),
  },
  {
    id: "live_gps_block",
    reason: "Consulta GPS/unidad en vivo tiene prioridad sobre cualquier guía.",
    decide: ({ text }) =>
      looksLikeGpsOrUnitStatusQuestion(text) || looksLikeLiveUnitConsultIntent(text) ? false : undefined,
  },
  {
    id: "odometer_problem_or_update_block",
    reason: "Falla u actualización explícita de odómetro no es guía.",
    decide: ({ text }) =>
      looksLikeOdometerProblemReport(text) || looksLikeExplicitOdometerUpdateRequest(text) ? false : undefined,
  },
  {
    id: "odometer_intent_block",
    reason: "Odómetro operativo en curso no debe desviarse a una guía.",
    decide: ({ text, threadText }) => (looksLikeOdometerIntent(text, threadText) ? false : undefined),
  },
  {
    id: "flow_control_block",
    reason: "Comando de flujo (reinicio/cancelar) se resuelve aparte, no es guía.",
    decide: ({ text }) => (looksLikeFlowControlCommand(text) ? false : undefined),
  },
  {
    id: "technical_support_block",
    reason: "Soporte técnico va a ticket, no a guía.",
    decide: ({ text }) => (looksLikeTechnicalSupportRequest(text) ? false : undefined),
  },
  {
    id: "pending_maintenance_plate_block",
    reason: "Selección de unidad tras pedido de patente de mantenimiento es operativo, no guía.",
    decide: ({ text, threadText }) =>
      hasPendingMaintenancePlateRequest(threadText) && isUnitSelectionMessage(text, threadText)
        ? false
        : undefined,
  },
  {
    id: "unit_selection_in_maintenance_guide_block",
    reason: "Selección de unidad dentro de una guía de mantenimiento indica que el cliente pasó a lo operativo.",
    decide: ({ text, threadText }) =>
      isUnitSelectionMessage(text, threadText) && looksLikeMaintenanceGuideContextInThread(threadText)
        ? false
        : undefined,
  },
  {
    id: "maintenance_operational_intent_block",
    reason: "Pedido operativo de mantenimiento no es guía.",
    decide: ({ text, threadText }) =>
      looksLikeOperationalMaintenanceIntent(text, threadText) ? false : undefined,
  },
  {
    id: "maintenance_capability_question_block",
    reason: "Pregunta de capacidad (¿podés registrarlo vos?) es operativo, no guía.",
    decide: ({ text, threadText }) =>
      looksLikeMaintenanceCapabilityQuestion(text, threadText) ? false : undefined,
  },
  {
    id: "module_pick_allow",
    reason: "Elección explícita de módulo (Opciones/Unidades/Mantenimiento) tras el menú es guía.",
    decide: ({ text }) => (looksLikeInfoGuideModulePick(text) ? true : undefined),
  },
  {
    id: "opciones_info_allow",
    reason: "Pedido explícito de guía del módulo Opciones.",
    decide: ({ text }) => (looksLikeOpcionesInfoRequest(text) ? true : undefined),
  },
  {
    id: "maintenance_info_allow",
    reason: "Pedido explícito de guía del módulo Mantenimiento.",
    decide: ({ text }) => (looksLikeMaintenanceInfoRequest(text) ? true : undefined),
  },
  {
    id: "unidades_info_allow",
    reason: "Pedido explícito de guía del módulo Unidades.",
    decide: ({ text }) => (looksLikeUnidadesInfoRequest(text) ? true : undefined),
  },
  {
    id: "unidades_info_in_thread_allow",
    reason: "El hilo ya pidió guía de Unidades y el mensaje actual precisa qué tipo de guía.",
    decide: ({ text, threadText }) =>
      looksLikeUnidadesInfoRequest(threadText) && !!detectInfoGuideKind(text) ? true : undefined,
  },
  {
    id: "platform_info_thread_explicit_allow",
    reason: "El hilo mostró una guía de plataforma y el mensaje pide una guía explícita puntual.",
    decide: ({ text, threadText }) =>
      looksLikePlatformInfoGuideInThread(threadText) && !!detectInfoGuideKind(text) ? true : undefined,
  },
  {
    id: "maintenance_info_guide_in_thread_allow",
    reason:
      "Venimos de una guía informativa de mantenimiento y el mensaje no es operativo: seguir en guía solo si es explícito o elige módulo.",
    decide: ({ text, threadText }) => {
      if (!looksLikeMaintenanceInfoGuideInThread(threadText)) return undefined;
      if (looksLikeMaintenanceOperational(text, threadText)) return undefined;
      return !!detectInfoGuideKind(text) || looksLikeInfoGuideModulePick(text);
    },
  },
  {
    id: "maintenance_guide_context_in_thread_allow",
    reason: "Contexto general de guía de mantenimiento en el hilo, mensaje no operativo.",
    decide: ({ text, threadText }) => {
      if (!looksLikeMaintenanceGuideContextInThread(threadText)) return undefined;
      if (looksLikeMaintenanceOperational(text, threadText)) return undefined;
      return !!detectInfoGuideKind(text) || looksLikeInfoGuideModulePick(text);
    },
  },
  {
    id: "generic_menu_offer_anti_loop_block",
    reason: "Anti-loop: si el hilo ya mostró el menú genérico, no forzar guía de nuevo.",
    decide: ({ threadText }) => (threadHasGenericPlatformMenuOffer(threadText) ? false : undefined),
  },
];

function looksLikeBbcInfoGuide(text: string, threadText: string): boolean {
  const ctx: InfoGuideRuleContext = { text, threadText };
  for (const rule of INFO_GUIDE_RULES) {
    const verdict = rule.decide(ctx);
    if (verdict !== undefined) return verdict;
  }
  return false;
}

/* -------------------------------------------------------------------------- */
/* Tabla de reglas — classifyTurnExecutor                                     */
/* -------------------------------------------------------------------------- */
/**
 * Prioridad explícita: se evalúan en el orden del array. `decide` devuelve el
 * ejecutor si la regla aplica, o `null` si hay que seguir con la próxima.
 * Transformación 1:1 del cascade de `if` anterior (mismo orden, misma condición
 * por rama) — ver docs/FASE-1.md y scripts/turn-classification.snapshot.json
 * para el comportamiento congelado que esta tabla debe reproducir exactamente.
 */
type TurnRuleContext = { text: string; threadText: string };
type TurnRule = {
  id: string;
  reason: string;
  decide: (ctx: TurnRuleContext) => TurnExecutorId | null;
};

const TURN_RULES: TurnRule[] = [
  {
    id: "unit_list_request",
    reason: "Pedido explícito de listado de unidades.",
    decide: ({ text }) => (looksLikeUnitListRequest(text) ? "unidades" : null),
  },
  {
    id: "conversation_close_request",
    reason: "Cliente pide cerrar la conversación/caso.",
    decide: ({ text }) => (looksLikeCustomerConversationCloseRequest(text) ? "odoo_ticket" : null),
  },
  {
    id: "open_case_status_inquiry",
    reason: "Cliente consulta el estado de un caso abierto.",
    decide: ({ text }) => (looksLikeOpenCaseStatusInquiry(text) ? "odoo_ticket" : null),
  },
  {
    id: "human_advisor_request",
    reason: "Pedido explícito de hablar con un asesor humano.",
    decide: ({ text }) => (looksLikeHumanAdvisorRequest(text) ? "odoo_ticket" : null),
  },
  {
    id: "explicit_reclamo_or_ticket_request",
    reason: "Reclamo o ticket explícito.",
    decide: ({ text }) => (looksLikeExplicitReclamoOrTicketRequest(text) ? "odoo_ticket" : null),
  },
  {
    id: "technical_support_request",
    reason: "Pedido explícito de soporte técnico.",
    decide: ({ text }) => (looksLikeTechnicalSupportRequest(text) ? "odoo_ticket" : null),
  },
  {
    id: "odometer_problem_report",
    reason: "Falla/desfase de odómetro es soporte, no menú de guías ni pedir km.",
    decide: ({ text }) => (looksLikeOdometerProblemReport(text) ? "odoo_ticket" : null),
  },
  {
    id: "gps_or_live_unit_consult",
    reason: "GPS/ignición/reporte en vivo — prioridad sobre guías y mantenimiento arrastrado del hilo.",
    decide: ({ text }) =>
      looksLikeGpsOrUnitStatusQuestion(text) || looksLikeLiveUnitConsultIntent(text) ? "unidades" : null,
  },
  {
    id: "odometer_operational",
    reason: "Odómetro operativo — antes que guías informativas (el hilo no debe secuestrar con mantenimiento).",
    decide: ({ text, threadText }) => {
      const match =
        looksLikeOdometerIntent(text, threadText) ||
        (looksLikeExplicitOdometerUpdateRequest(text) &&
          (threadHasActiveOdometerFlow(threadText) ||
            isUnitSelectionMessage(text, threadText) ||
            looksLikePlateCorrectionRequest(text))) ||
        (!isOdometerFlowSuperseded(threadText) &&
          threadHasActiveOdometerFlow(threadText) &&
          (isUnitSelectionMessage(text, threadText) ||
            looksLikePlateCorrectionRequest(text) ||
            /\bpatente\s+(?:de|del)\b/i.test(norm(text)))) ||
        (looksLikePlateCorrectionRequest(text) && /od[oó]metro|hor[oó]metro|kilometraje/.test(norm(threadText)));
      return match ? "odometro" : null;
    },
  },
  {
    id: "pending_maintenance_plate_selection",
    reason:
      "Patente/prefijo/marca tras pedido de mantenimiento — salvo que el hilo sea consulta de unidad reciente.",
    decide: ({ text, threadText }) => {
      if (!hasPendingMaintenancePlateRequest(threadText) || !isUnitSelectionMessage(text, threadText)) {
        return null;
      }
      if (threadHasRecentLiveUnitConsultIntent(threadText) && looksLikeVehicleBrandOrUnitSearch(text)) {
        return "unidades";
      }
      return "mantenimiento";
    },
  },
  {
    id: "bbc_info_guide",
    reason: "Guías informativas → backend (Opciones, Unidades, Mantenimiento informativo).",
    decide: ({ text, threadText }) => (looksLikeBbcInfoGuide(text, threadText) ? "info_guides" : null),
  },
  {
    id: "pending_confirmation_resolver",
    reason: "Confirmaciones pendientes explícitas en el hilo — resolver único (cert > odo > maint).",
    decide: ({ text, threadText }) => {
      if (looksLikeFlowControlCommand(text)) return null;
      return resolvePendingConfirmationExecutor(threadText, text) ?? null;
    },
  },
  {
    id: "pending_mantenimiento_confirmation_diverted_by_new_topic",
    reason:
      "Con confirmación de mantenimiento pendiente, un mensaje sustantivo (no confirmación breve) que es GPS/incidente cambia de tema.",
    decide: ({ text, threadText }) => {
      const guarded =
        hasPendingMantenimientoConfirmation(threadText) &&
        looksLikeSubstantiveCustomerMessage(text) &&
        !looksLikeBriefConfirmation(text);
      if (!guarded) return null;
      if (looksLikeGpsOrUnitStatusQuestion(text) || detectIncidentType(text) !== "OTHER") {
        return "unidades";
      }
      return null;
    },
  },
  {
    id: "post_advisor_case_no_reopen",
    reason:
      "Tras caso/asesor informado: no re-abrir Odoo por 'confirmo'/'dale'/'gracias' ni por palabras del hilo.",
    decide: ({ text, threadText }) => {
      const guarded =
        looksLikePostAdvisorCaseThread(threadText) &&
        (looksLikeConversationAcknowledgement(text) ||
          (looksLikeBriefConfirmation(text) &&
            !hasPendingCertificateConfirmation(threadText) &&
            !hasPendingOdometerConfirmation(threadText) &&
            !hasPendingMantenimientoConfirmation(threadText)));
      return guarded ? "unidades" : null;
    },
  },
  {
    id: "certificate_intent",
    reason: "Certificado: pedido explícito o hilo con trámite de certificado activo.",
    decide: ({ text, threadText }) => (looksLikeCertificateIntent(text, threadText) ? "certificados" : null),
  },
  {
    id: "certificate_unit_context_selection",
    reason: "Respuesta de unidad tras 'necesito la unidad' del flujo de certificado.",
    decide: ({ text, threadText }) =>
      isCertificateUnitContext(threadText) && isUnitSelectionMessage(text, threadText) ? "certificados" : null,
  },
  {
    id: "pending_maintenance_plate_selection_redundant",
    reason: "Patente pedida en contexto de mantenimiento (también cubierto arriba; redundante por claridad).",
    decide: ({ text, threadText }) =>
      hasPendingMaintenancePlateRequest(threadText) && isUnitSelectionMessage(text, threadText)
        ? "mantenimiento"
        : null,
  },
  {
    id: "maintenance_operational",
    reason: "Pedido operativo de mantenimiento (programar/registrar correctivo o preventivo).",
    decide: ({ text, threadText }) => (looksLikeMaintenanceOperational(text, threadText) ? "mantenimiento" : null),
  },
  {
    id: "incident_admin_or_access",
    reason: "Derivación administrativa o de acceso a la plataforma va directo a ticket.",
    decide: ({ text }) => {
      const incident = detectIncidentType(text);
      return incident === "ADMIN_DERIVATION" || incident === "ACCESS_PLATFORM" ? "odoo_ticket" : null;
    },
  },
  {
    id: "loose_plate_or_operational_fallback",
    reason: "Patente/prefijo suelto, incidente detectado, o intención operativa genérica → consulta de unidad.",
    decide: ({ text, threadText }) => {
      const incident = detectIncidentType(text);
      const match =
        detectLoosePlate(text) || isBarePlatePrefixHint(text) || incident !== "OTHER" || looksLikeOperationalIntent(text);
      if (!match) return null;
      if (threadHasActiveOdometerFlow(threadText) && looksLikeFleetUnitSearchInput(text)) {
        return "odometro";
      }
      return "unidades";
    },
  },
  {
    id: "keyword_ticket_fallback",
    reason: "Última red: palabra clave de reclamo/ticket/caso/problema/falla/avería suelta.",
    decide: ({ text }) => (/\b(reclamo|ticket|caso|problema|falla|aver[ií]a)\b/i.test(text) ? "odoo_ticket" : null),
  },
];

/**
 * Clasifica el ejecutor backend (Fase 1 — cerebro único).
 * Prioridad alineada con sync-builderbot-router-wara.mjs (histórico, ver docs/bbc-flows-eliminados-2026-07-22.md).
 * Reglas explícitas y ordenadas en TURN_RULES — agregar una regla nueva implica decidir
 * conscientemente en qué posición de la lista va, no adivinar el orden de un cascade de `if`.
 */
export function classifyTurnExecutor(selectionText: string, threadText: string): TurnExecutorId {
  const ctx: TurnRuleContext = { text: selectionText.trim(), threadText };
  for (const rule of TURN_RULES) {
    const executor = rule.decide(ctx);
    if (executor) return executor;
  }
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
