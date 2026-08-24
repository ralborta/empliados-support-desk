/**
 * Expectativa estructurada tras `stage=clarify_odometer_intent` en outbound.
 * El estado vive en `Customer.pendingAction.payload.stage`, no en el texto del bot.
 */
import type { PendingActionRecord } from "@/lib/pendingAction";
import {
  looksLikeBareOdometerTopicMention,
  looksLikeCertificateKeyword,
  looksLikeExplicitOdometerUpdateRequest,
  looksLikeHorometerOnlyIntent,
  looksLikeMaintenanceKeyword,
  looksLikeOdometerInfoRequest,
} from "@/lib/wara";
import {
  looksLikeFlowControlCommand,
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
 * Intención explícita nueva que reemplaza la expectativa `odometer_action_choice`.
 * No incluye la respuesta corregir/actualizar (esa la consume el trámite).
 */
export function shouldSupersedeOdometerActionChoice(text: string): boolean {
  if (looksLikeOdometerActionChoiceReply(text)) return false;
  if (looksLikeFlowControlCommand(text)) return true;
  if (looksLikeExplicitOtherTramiteIntent(text)) return true;
  if (looksLikeCertificateKeyword(text)) return true;
  if (looksLikeMaintenanceKeyword(text)) return true;
  if (looksLikeGpsOrUnitStatusQuestion(text) || looksLikeLiveUnitConsultIntent(text)) return true;
  if (looksLikeExplicitOdometerUpdateRequest(text) || looksLikeHorometerOnlyIntent(text)) return true;
  if (looksLikeBareOdometerTopicMention(text)) return true;
  if (looksLikeOdometerInfoRequest(text)) return true;
  return false;
}
