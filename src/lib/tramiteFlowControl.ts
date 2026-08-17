/**
 * Cancelación y reanudación de trámites inconclusos (odómetro, certificado,
 * mantenimiento) — comportamiento uniforme en todos los executors.
 */
import type { PendingActionRecord } from "@/lib/pendingAction";
import {
  certificateFlowState,
  hasPendingMaintenancePlateRequest,
  threadAwaitingHorometerKmValue,
  threadAwaitingOdometerKmValue,
  threadHasActiveOdometerFlow,
} from "@/lib/wara";
import { hasAnyPendingConfirmation } from "@/lib/pendingConfirmation";
import {
  buildPendingConfirmStillWaitingReminder,
  detectPendingConfirmKind,
  type PendingConfirmKind,
} from "@/lib/pendingConfirmStance";

function normTramiteText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[¡!¿?.,;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Cancelación / abandono explícito de un trámite en curso. */
export function looksLikeTramiteCancellationIntent(text: string | undefined | null): boolean {
  const raw = String(text ?? "").trim();
  if (!raw || raw.length > 160) return false;
  const t = normTramiteText(raw);
  if (!t) return false;

  // "no" solo → corrección de unidad / CONFIRMO, no cancelación global.
  if (/^(no|nop|nope|nel|nah)(?:[\s,]+no)?$/.test(t)) return false;

  if (/^(cancelar|cancela|cancelalo|cancelala|anular|anula|olvidalo|olvidala|dejalo|dejala|abortar|detener|salir)$/.test(t)) {
    return true;
  }
  if (
    /^(cancelar|cancela|cancelalo|cancelala)\s+(el\s+)?(tramite|solicitud|todo|certificado|odometro|horometro|mantenimiento|registro)?\.?$/.test(
      t,
    )
  ) {
    return true;
  }
  if (/^(deja|dej[aá]|olvidalo|olvidala)\s+(el\s+)?(tramite|solicitud|certificado|registro)\.?$/.test(t)) {
    return true;
  }
  if (/\b(ya\s+)?no\s+quiero(\s+(ahora|por\s+ahora|seguir|continuar|registrar|esto|eso))?\b/.test(t)) {
    return true;
  }
  if (/\bno\s+quiero\s+(ahora|por\s+ahora|seguir|continuar|registrar)\b/.test(t)) {
    return true;
  }
  if (/\bahora\s+no\b/.test(t) || /\bpor\s+ahora\s+no\b/.test(t)) {
    return true;
  }
  if (/\bno\s+sig(o|amos|uimos)\b/.test(t)) {
    return true;
  }
  if (/\b(dejemos|dejalo|dejala|dej[aá])\s+(as[ií]|esto|el\s+tramite)\b/.test(t)) {
    return true;
  }
  if (/\b(anul\w*|desestim\w*|descart\w*)\s+(el\s+)?(tramite|solicitud|registro)\b/.test(t)) {
    return true;
  }
  if (/\bno\s+(lo\s+)?registres?\b/.test(t)) {
    return true;
  }
  if (
    /\b(no\s+quiero|no\s+necesito)\b[^.!?]{0,40}\b(certificado|cobertura|odometro|horometro|mantenimiento)\b/.test(
      t,
    )
  ) {
    return true;
  }
  if (/\b(cancelar|cancelalo|olvidalo|anular)\b/.test(t) && t.length <= 48) {
    return true;
  }
  return false;
}

/** Hay un trámite operativo sin cerrar (CONFIRMO, datos faltantes, etc.). */
export function threadHasInconclusiveTramite(
  threadText: string,
  pendingAction?: PendingActionRecord | null,
): boolean {
  if (hasAnyPendingConfirmation(threadText)) return true;
  if (pendingAction?.payload) return true;
  if (threadHasActiveOdometerFlow(threadText)) return true;
  if (hasPendingMaintenancePlateRequest(threadText)) return true;
  const cert = certificateFlowState(threadText);
  return cert === "awaiting_unit" || cert === "awaiting_confirm";
}

function inferTramiteKind(
  threadText: string,
  pendingAction?: PendingActionRecord | null,
): PendingConfirmKind | "certificados_mid" | null {
  const confirm = detectPendingConfirmKind(threadText);
  if (confirm) return confirm;
  if (pendingAction?.type === "odometro" || pendingAction?.type === "certificados" || pendingAction?.type === "mantenimiento") {
    return pendingAction.type;
  }
  if (threadHasActiveOdometerFlow(threadText)) return "odometro";
  if (hasPendingMaintenancePlateRequest(threadText)) return "mantenimiento";
  const cert = certificateFlowState(threadText);
  if (cert !== "none") return "certificados";
  return null;
}

export function buildTramiteCancellationReply(
  threadText: string,
  pendingAction?: PendingActionRecord | null,
): string {
  const kind = inferTramiteKind(threadText, pendingAction);
  if (kind === "odometro") {
    return "Entendido, no registro ese cambio de odómetro/horómetro. ¿En qué más te ayudo?";
  }
  if (kind === "certificados" || kind === "certificados_mid") {
    return "Listo, cancelé la solicitud del certificado. ¿En qué más te ayudo?";
  }
  if (kind === "mantenimiento") {
    return "Entendido, no registro ese mantenimiento. ¿En qué más te ayudo? Podés pedirme odómetro, horómetro, certificado o consultar el estado de una unidad.";
  }
  return "Entendido, cancelé ese paso. ¿En qué más te ayudo?";
}

/** Cliente pide retomar un trámite que quedó a medias (no es CONFIRMO). */
export function looksLikeResumeInconclusiveTramite(text: string | undefined | null): boolean {
  const raw = String(text ?? "").trim();
  if (!raw || raw.length > 120) return false;
  const t = normTramiteText(raw);
  if (!t || looksLikeTramiteCancellationIntent(raw)) return false;
  if (/\b(cancel|no\s+quiero)\b/.test(t)) return false;
  if (/\b(con|en)\s+(el|la)?\s*(wara|cacique|empresa)\b/.test(t)) return false;

  if (
    /\b(continuamos|continuar|continuemos|seguimos|sigamos|retomamos|retomar|retomemos|volvamos)\b/.test(
      t,
    )
  ) {
    return true;
  }
  if (/\b(donde\s+quedamos|seguir\s+con|volvamos\s+al)\b/.test(t)) {
    return true;
  }
  if (/^(dale|ok|listo|bueno)\s*,?\s*(seguimos|sigamos|continuemos|retomemos)?$/.test(t)) {
    return true;
  }
  return false;
}

export function buildInconclusiveTramiteResumePrompt(
  threadText: string,
  pendingAction?: PendingActionRecord | null,
): string {
  const confirmKind = detectPendingConfirmKind(threadText);
  if (confirmKind) {
    return `¿Seguimos? ${buildPendingConfirmStillWaitingReminder(confirmKind)}`;
  }
  if (threadAwaitingHorometerKmValue(threadText)) {
    return "¿Seguimos con el cambio de horómetro? Pasame el valor en horas y la fecha/hora de la lectura.";
  }
  if (threadAwaitingOdometerKmValue(threadText)) {
    return "¿Seguimos con el cambio de odómetro? Pasame el kilometraje y la fecha/hora de la lectura.";
  }
  if (threadHasActiveOdometerFlow(threadText) || pendingAction?.type === "odometro") {
    return "¿Seguimos con el cambio de odómetro/horómetro? Decime la unidad o el dato que faltaba.";
  }
  if (certificateFlowState(threadText) === "awaiting_unit" || pendingAction?.type === "certificados") {
    return "¿Seguimos con el certificado? Pasame la patente o unidad.";
  }
  if (hasPendingMaintenancePlateRequest(threadText) || pendingAction?.type === "mantenimiento") {
    return "¿Seguimos con el mantenimiento? Decime la patente de la unidad y si es preventivo o correctivo.";
  }
  return "¿Seguimos con lo que estábamos haciendo? Decime qué dato te falta o qué querés hacer.";
}

export function resolveExecutorForInconclusiveTramite(
  threadText: string,
  pendingAction?: PendingActionRecord | null,
): "odometro" | "certificados" | "mantenimiento" | "info_guides" {
  const kind = inferTramiteKind(threadText, pendingAction);
  if (kind === "odometro") return "odometro";
  if (kind === "certificados" || kind === "certificados_mid") return "certificados";
  if (kind === "mantenimiento") return "mantenimiento";
  return "info_guides";
}
