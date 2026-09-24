/**
 * Expectativa estructurada tras `stage=clarify_odometer_intent` en outbound.
 * El estado vive en `Customer.pendingAction.payload.stage`, no en el texto del bot.
 */
import type { PendingActionRecord } from "@/lib/pendingAction";
import {
  detectLoosePlate,
  extractUnitCodeNumbersFromMessage,
  looksLikeBareOdometerTopicMention,
  looksLikeCertificateKeyword,
  looksLikeExplicitOdometerUpdateRequest,
  looksLikeHorometerOnlyIntent,
  looksLikeMaintenanceKeyword,
  looksLikeOdometerInfoRequest,
} from "@/lib/wara";
import {
  looksLikeFlowControlCommand,
  looksLikeSoftFlowRestart,
  looksLikeGpsOrUnitStatusQuestion,
  looksLikeLiveUnitConsultIntent,
} from "@/lib/waraApi";
import { looksLikeExplicitOtherTramiteIntent } from "@/lib/turnLayerContract";

export const ODOMETER_ACTION_CHOICE_STAGE = "odometer_action_choice";
export const CLARIFY_ODOMETER_INTENT_STAGE = "clarify_odometer_intent";

export type OdometerActionChoice = "corregir" | "actualizar";

export function hasPendingOdometerActionChoice(
  pendingAction?: PendingActionRecord | { type?: string; payload?: Record<string, unknown> } | null,
): boolean {
  return (
    pendingAction?.type === "odometro" &&
    pendingAction.payload?.stage === ODOMETER_ACTION_CHOICE_STAGE
  );
}

function normActionChoiceText(text: string): string {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[¡!¿?.,;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Respuesta corta al menú corregir/actualizar (sin exigir «odómetro» en el mensaje). */
export function parseOdometerActionChoice(text: string): OdometerActionChoice | null {
  const t = normActionChoiceText(text);
  if (!t) return null;
  if (/^actualizar(\s+(el\s+)?(kilometraje|km))?\.?$/.test(t)) return "actualizar";
  if (/^corregir(\s+(el\s+)?(kilometraje|km))?\.?$/.test(t)) return "corregir";
  return null;
}

export function looksLikeOdometerActionChoiceReply(text: string): boolean {
  return parseOdometerActionChoice(text) !== null;
}

/**
 * Afirmación breve sin unidad ni elección corregir/actualizar.
 * No inventa la opción: el trámite debe repreguntar o pedir datos.
 */
export function looksLikeBareAffirmationToOdometerActionChoice(text: string): boolean {
  const t = normActionChoiceText(text);
  if (!t) return false;
  return /^(si|sip|sep|dale|ok|okay|va|claro)s?$/.test(t);
}

/** ¿El mensaje trae un interno/código/patente usable como unidad? */
export function messageHasOdometerActionChoiceUnitRef(text: string): boolean {
  const raw = String(text ?? "").trim();
  if (!raw) return false;
  if (detectLoosePlate(raw)) return true;
  if (extractUnitCodeNumbersFromMessage(raw).length > 0) return true;
  if (/\binterno\s*[:\-]?\s*\d{3,7}\b/i.test(raw)) return true;
  const t = normActionChoiceText(raw);
  const compact = t.replace(/[\s\-_.]+/g, "");
  if (/^\d{5,7}$/.test(compact)) return true;
  // Interno embebido en frase corta («sí, en 900173») — formato estructural, no un id fijo.
  if (/\b\d{5,7}\b/.test(t)) return true;
  if (/\bm?\d{3}-\d{2,3}\b/i.test(raw)) return true;
  return false;
}

/**
 * Continuación del menú clarify con unidad (ej. «sí, en 900173» / «900173»).
 * Sigue en odómetro y captura unidad; NO inventa corregir vs actualizar.
 */
export function looksLikeOdometerActionChoiceUnitContinuation(text: string): boolean {
  if (looksLikeOdometerActionChoiceReply(text)) return false;
  if (looksLikeBareAffirmationToOdometerActionChoice(text)) return false;
  if (shouldSupersedeOdometerActionChoice(text)) return false;
  return messageHasOdometerActionChoiceUnitRef(text);
}

/**
 * Intención explícita nueva que reemplaza la expectativa `odometer_action_choice`.
 * No incluye la respuesta corregir/actualizar (esa la consume el trámite).
 */
export function shouldSupersedeOdometerActionChoice(text: string): boolean {
  if (looksLikeOdometerActionChoiceReply(text)) return false;
  if (looksLikeFlowControlCommand(text)) return true;
  if (looksLikeSoftFlowRestart(text)) return true;
  if (looksLikeExplicitOtherTramiteIntent(text)) return true;
  if (looksLikeCertificateKeyword(text)) return true;
  if (looksLikeMaintenanceKeyword(text)) return true;
  if (looksLikeGpsOrUnitStatusQuestion(text) || looksLikeLiveUnitConsultIntent(text)) return true;
  if (looksLikeExplicitOdometerUpdateRequest(text) || looksLikeHorometerOnlyIntent(text)) return true;
  if (looksLikeBareOdometerTopicMention(text)) return true;
  if (looksLikeOdometerInfoRequest(text)) return true;
  return false;
}

/**
 * ¿El mensaje es una respuesta compatible con el campo esperado del pending de odómetro?
 * Protege interno/km/fecha frente a historial de certificado, sin secuestrar consultas laterales.
 */
export function isCompatibleLiveOdometerPendingReply(
  text: string,
  pendingAction?: PendingActionRecord | { type?: string; payload?: Record<string, unknown> } | null,
  threadText = "",
): boolean {
  if (pendingAction?.type !== "odometro") return false;
  if (hasPendingOdometerActionChoice(pendingAction)) {
    return (
      looksLikeOdometerActionChoiceReply(text) ||
      looksLikeBareAffirmationToOdometerActionChoice(text) ||
      looksLikeOdometerActionChoiceUnitContinuation(text)
    );
  }

  const payload = pendingAction.payload ?? {};
  const stage = String(payload.stage ?? "");
  const layer =
    payload.turnLayer && typeof payload.turnLayer === "object"
      ? (payload.turnLayer as { activeExpectation?: string | null })
      : null;
  const exp = String(layer?.activeExpectation ?? "").trim();

  if (messageHasOdometerActionChoiceUnitRef(text)) {
    // Unidad nueva / interno: compatible con pedir unidad o con pivot durante collecting.
    if (
      !exp ||
      exp === "unit" ||
      exp === "clarification" ||
      exp === "km" ||
      exp === "fecha_hora" ||
      stage === "missing_plate" ||
      stage === "collecting" ||
      stage === "missing_value_fecha_hora"
    ) {
      return true;
    }
  }

  const bare = /^\d{1,7}$/.test(String(text ?? "").trim());
  if (bare && (exp === "km" || stage === "collecting" || stage === "missing_value_fecha_hora")) {
    return true;
  }

  // Fecha/hora de lectura (sin abrir consultas laterales).
  const t = normActionChoiceText(text);
  if (
    (exp === "fecha_hora" || stage === "collecting" || stage === "missing_value_fecha_hora") &&
    /\b(\d{1,2}[\/\-]\d{1,2}([\/\-]\d{2,4})?|\d{1,2}:\d{2}|ayer|hoy|anteayer)\b/.test(t)
  ) {
    return true;
  }

  if (exp === "confirmo" || /confirm/i.test(stage)) {
    return /^(si|sip|dale|ok|okay|confirmo|confirmó|confirmo)$/i.test(t);
  }

  // No tratar hilo genérico como “compatible”: evita secuestrar guías/saludos.
  void threadText;
  return false;
}
