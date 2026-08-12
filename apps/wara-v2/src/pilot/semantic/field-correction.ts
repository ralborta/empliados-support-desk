/**
 * Detección determinística de corrección de campos (odómetro/horómetro).
 * Distingue cancelar / corregir / rechazar resumen / cambiar intención.
 */
import type { TurnDecision } from "./turn-decision-schema.js";
import type { PilotConversationState } from "../conversation-state.js";
import { resolveNaturalReadingDatetime } from "./natural-datetime.js";

function norm(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export type ClearableField = "date" | "time" | "numericValue" | "unit";

const CANCEL_ONLY =
  /^(cancelar|cancelalo|cancelá|cancela|olvidalo|dejalo|salir)[!?.]*$/i;

export function looksLikeCancelTramiteOnly(text: string): boolean {
  const n = norm(text);
  if (CANCEL_ONLY.test(n)) return true;
  if (/\b(cancelar|cancela)\b/.test(n) && /\b(tramite|solicitud|todo)\b/.test(n)) return true;
  if (/\bcorreg|\bfecha|\bhora|\bvalor|\bodometro|\bhorometro/.test(n)) return false;
  return false;
}

/**
 * Detecta pedido de corrección de campo sin cancelar el trámite.
 */
export function detectOdometerFieldCorrection(
  text: string,
  state: PilotConversationState,
  opts?: { timezone?: string; localNow?: string },
): TurnDecision | null {
  const draft = state.odometerDraft;
  const pendingOdo =
    state.pendingConfirmation?.action === "odometer_write" ||
    state.activeTramite === "odometer_update" ||
    Boolean(draft && draft.step !== "idle");
  if (!pendingOdo || !draft) return null;

  const n = norm(text);
  if (!n || looksLikeCancelTramiteOnly(text)) return null;

  // Cambio de intención explícito → no forzar correct_fields.
  if (
    /\b(quiero|necesito)\b/.test(n) &&
    /\b(certificado|gps|mantenimiento|reclamo|ticket)\b/.test(n) &&
    !/\b(fecha|hora|valor|odometro|horometro)\b/.test(n)
  ) {
    return null;
  }

  const wantsDateClear =
    /\b(fecha)\b/.test(n) &&
    /\b(mal|incorrecta|equivocada|errada|no\s+es|no\s+fue|correg|cambia|cambiar|no\s+era)\b/.test(n);
  const wantsDateClearAlt =
    /\bno\s+fue\s+el\s+(sabado|domingo|lunes|martes|miercoles|jueves|viernes)\b/.test(n) ||
    /\bla\s+fecha\s+no\s+es\b/.test(n) ||
    /\besa\s+no\s+es\s+la\s+fecha\b/.test(n) ||
    /\bno\s+era\s+el\s+(sabado|domingo|lunes|martes|miercoles|jueves|viernes)\b/.test(n) ||
    /\bcorreg(i|í|ir|í)\s+la\s+fecha\b/.test(n) ||
    /\bquiero\s+(q|que)\s+corrij/.test(n) ||
    /\bcambia(r|)\s+la\s+fecha\b/.test(n) ||
    /\bera\s+el\s+(sabado|domingo|lunes|martes|miercoles|jueves|viernes)\b/.test(n) ||
    /\bera\s+el\s+\d{1,2}\b/.test(n) ||
    /\bcambia(r|)\s+la\s+fecha\s+al\b/.test(n);

  const wantsTimeClear =
    (/\b(hora)\b/.test(n) &&
      /\b(mal|incorrecta|equivocada|correg|cambia|cambiar|era)\b/.test(n)) ||
    /\bcorreg(i|í|ir)\s+la\s+hora\b/.test(n) ||
    /\bquiero\s+cambiar\s+la\s+hora\b/.test(n) ||
    /\bera\s+\d{1,2}:\d{2}\b/.test(n);

  const wantsValueClear =
    (/\b(valor|odometro|horometro|kilometraje|km)\b/.test(n) &&
      /\b(mal|incorrecto|equivocado|errado|correg|cambia)\b/.test(n)) ||
    /\bel\s+valor\s+est[aá]\s+(mal|equivocado)\b/.test(n);

  const explicitCorrection =
    wantsDateClear || wantsDateClearAlt || wantsTimeClear || wantsValueClear;
  // Solo interceptar si hay señal de corrección. Proveer fecha/hora por primera vez
  // ("el sábado 18:15", "06/08/2026 15:50") debe ir al cerebro/provide_fields.
  if (!explicitCorrection) return null;

  const fieldsToClear: ClearableField[] = [];
  if (wantsDateClear || wantsDateClearAlt) fieldsToClear.push("date");
  if (wantsTimeClear) fieldsToClear.push("time");
  if (wantsValueClear) fieldsToClear.push("numericValue");

  // "era el domingo" / "era el 8, no el 6" / "era 18:30" / "cambiá la fecha al sábado 8"
  const replacement = resolveNaturalReadingDatetime(text, {
    timezone: opts?.timezone,
    localNow: opts?.localNow,
  });
  const hasReplacementDate =
    replacement.kind === "resolved" &&
    (replacement.source === "weekday" ||
      replacement.source === "relative" ||
      replacement.source === "numeric");
  const hasReplacementTime =
    (replacement.kind === "resolved" || replacement.kind === "future_explicit") &&
    Boolean(replacement.time) &&
    (/\bera\b/.test(n) || /\bhora\b/.test(n) || /\d{1,2}:\d{2}/.test(n));

  if (hasReplacementDate && !fieldsToClear.includes("date")) fieldsToClear.push("date");
  if (hasReplacementTime && !fieldsToClear.includes("time")) fieldsToClear.push("time");

  if (fieldsToClear.length === 0) return null;

  const fields: TurnDecision["fields"] = {
    date: hasReplacementDate && replacement.kind === "resolved" ? replacement.date : null,
    time:
      hasReplacementTime && (replacement.kind === "resolved" || replacement.kind === "future_explicit")
        ? replacement.time
        : null,
    numericValue: null,
    timezone: opts?.timezone ?? "America/Argentina/Buenos_Aires",
  };

  return {
    action: "correct_fields",
    intent: draft.meterType === "horometro" ? "horometer" : "odometer",
    confidence: 0.95,
    currentTramiteDisposition: "keep",
    reasoningCode: "PROVIDED_MISSING_FIELD",
    answer: null,
    entity: null,
    ambiguity: null,
    fields,
    fieldsToClear,
  };
}
