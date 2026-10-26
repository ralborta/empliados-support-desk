/**
 * Comandos operacionales inequívocos de cancelación / continuación.
 * No son heurísticas conversacionales: son órdenes al trámite activo/pending.
 */
import type { PilotConversationState } from "../conversation-state.js";
import { looksLikeUnequivocalCancelRequest } from "./turn-precedence.js";

function norm(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Menciona otro servicio además de cancelar certificado → debe ir al cerebro. */
export function mentionsAnotherServiceAlongsideCancel(text: string): boolean {
  const t = norm(text);
  if (!t) return false;
  // Conector de cambio / pedido adicional
  const hasOtherService =
    /\b(odometro|horometro|gps|reporte|mantenimiento|ticket|asesor|unidades?|lista)\b/.test(t) ||
    /\b(quiero|necesito|mejor)\s+(cambiar|pedir|ver|consultar|registrar)/.test(t);
  const hasCancelCert =
    /\bcertificado\b/.test(t) &&
    /\b(no\s+quiero|no\s+necesito|cancel|deja|olvid)/.test(t);
  const bareCancel = /^(cancelar|cancela|cancelalo|cancelala)$/.test(t);
  if (bareCancel) return false;
  if (hasCancelCert && hasOtherService) return true;
  // "cancelar ... y quiero odómetro"
  if (/\bcancel/.test(t) && hasOtherService) return true;
  return false;
}

/**
 * ¿Puede resolverse con atajo determinístico de cancelación?
 * Solo si el objetivo es inequívoco por estado + texto.
 */
export function shouldUseCancelShortcut(
  text: string,
  state: PilotConversationState,
): boolean {
  const t = norm(text);
  if (!t) return false;
  // Frases mixtas → LLM
  if (mentionsAnotherServiceAlongsideCancel(t)) return false;

  const certPending =
    state.pendingConfirmation?.action === "certificate_issue" ||
    state.activeTramite === "certificate_issue" ||
    Boolean(state.certificateDraft);
  const odoPending =
    state.pendingConfirmation?.action === "odometer_write" ||
    state.activeTramite === "odometer_update" ||
    Boolean(state.odometerDraft);
  const gpsPending = state.pendingConfirmation?.action === "gps_report";
  const maintPending =
    state.pendingConfirmation?.action === "maintenance_write" ||
    state.activeTramite.startsWith("maintenance");
  const ticketPending =
    state.pendingConfirmation?.action === "odoo_ticket_create" ||
    state.activeTramite === "odoo_ticket";

  const activeCount = [certPending, odoPending, gpsPending, maintPending, ticketPending].filter(
    Boolean,
  ).length;

  // Cancelación inequívoca con un único trámite cancelable.
  if (looksLikeUnequivocalCancelRequest(t) && activeCount === 1) {
    return true;
  }

  // cancelar el certificado / no quiero el certificado → solo si certificado es el objetivo.
  if (
    /^(cancelar|cancela|cancelalo|cancelala)\s+(el\s+)?certificado\.?$/.test(t) ||
    /^(deja|dej[aá]|olvidalo|olvidala)\s+(el\s+)?(certificado|solicitud)\.?$/.test(t) ||
    (/\b(no\s+quiero|no\s+necesito|osea\s+no\s+quiero|o\s+sea\s+no\s+quiero)\b/.test(t) &&
      /\bcertificado\b/.test(t))
  ) {
    return certPending;
  }

  // cancelar el odómetro / etc. acotado
  if (/^(cancelar|cancela|cancelalo)\s+(el\s+)?(odometro|horometro)\.?$/.test(t)) {
    return odoPending && activeCount === 1;
  }

  // cancelar el trámite / solicitud genérico con un solo pending
  if (/^(cancelar|cancela|cancelalo)\s+(el\s+)?(tramite|solicitud|todo)?\.?$/.test(t)) {
    return activeCount === 1;
  }

  return false;
}

/** @deprecated usar shouldUseCancelShortcut */
export function isUnequivocalCancelCommand(text: string): boolean {
  const t = norm(text);
  if (!t) return false;
  if (/^(cancelar|cancela|cancelalo|cancelala|anular|anula)$/.test(t)) return true;
  if (
    /^(cancelar|cancela|cancelalo|cancelala)\s+(el\s+)?(certificado|tramite|solicitud|odometro|horometro|gps|todo)?\.?$/.test(
      t,
    )
  ) {
    return true;
  }
  if (/^(deja|dej[aá]|olvidalo|olvidala)\s+(el\s+)?(certificado|tramite|solicitud)\.?$/.test(t)) {
    return true;
  }
  if (
    /\b(no\s+quiero|no\s+necesito|osea\s+no\s+quiero|o\s+sea\s+no\s+quiero)\b/.test(t) &&
    /\bcertificado\b/.test(t) &&
    !/\b(odometro|horometro|gps|reporte)\b/.test(t)
  ) {
    return true;
  }
  return false;
}

export function isUnequivocalContinueCommand(text: string): boolean {
  const t = norm(text);
  return /^(continuar|continua|continuemos|seguimos|seguir|sigamos|dale|ok|listo|bueno\s*,?\s*(sigamos|seguimos|continuar|continuemos))$/.test(
    t,
  );
}

/** Pregunta compuesta cancelar/continuar — sí/no no son seguros. */
export function isCompoundCancelContinueQuestion(question: string | null | undefined): boolean {
  const q = norm(String(question ?? ""));
  if (!q) return false;
  const hasCancel = /\bcancel/.test(q);
  const hasContinue = /\b(continuar|continua|seguir|seguimos)\b/.test(q);
  return hasCancel && hasContinue;
}

export function isBinaryCancelQuestion(question: string | null | undefined): boolean {
  const q = norm(String(question ?? ""));
  if (!q) return false;
  if (isCompoundCancelContinueQuestion(q)) return false;
  return /\bqueres\s+cancelar\b/.test(q) || /\bcancelar\s+la\s+solicitud\b/.test(q);
}

export const CANCEL_CERT_REPLY =
  "Listo, cancelé la solicitud del certificado. ¿En qué más te ayudo?";

export const COMPOUND_CHOICE_REPLY = 'Decime “cancelar” o “continuar”.';
