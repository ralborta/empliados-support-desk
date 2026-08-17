import type { ConversationStateV3 } from "../../commander-v3/types/state.js";
import { isUnequivocalWriteConfirm } from "../../commander-v3/enrich/confirmation-outcome.js";
import type { TurnInterpretation } from "../types/interpretation.js";
import type { TurnDecision } from "../types/decision.js";
import { migrateV3ToVNext } from "../state/migrate.js";

export const NO_PENDING_CONFIRM_MESSAGE =
  "No tengo ninguna operación pendiente para confirmar.";

export const STALE_CONFIRM_MESSAGE =
  "Esa confirmación ya no corresponde; el trámite cambió o se canceló.";

export const DUPLICATE_CONFIRM_MESSAGE =
  "Ya no hay nada pendiente de confirmar.";

function norm(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function isAffirmativeWriteConfirm(message: string): boolean {
  if (isUnequivocalWriteConfirm(message)) return true;
  const t = norm(message);
  if (/^(si|sí)\s*,?\s*confirmo\b/.test(t)) return true;
  if (/^confirmo\s*,?\s*(si|sí)\b/.test(t)) return true;
  return false;
}

export function isConfirmationQuestion(message: string): boolean {
  const t = norm(message);
  if (!/\bconfirm/.test(t)) return false;
  if (
    /\b(que\s+pasa|qué\s+pasa|que\s+ocurre|qué\s+ocurre|que\s+sucede|qué\s+sucede)\b/.test(
      t,
    )
  ) {
    return true;
  }
  return message.trim().startsWith("¿") && /\bconfirm/.test(t);
}

export function isConfirmWithCorrection(
  message: string,
  interpretation: TurnInterpretation,
): boolean {
  if (interpretation.confirmation?.containsCorrections) return true;
  if (
    interpretation.corrections.length > 0 &&
    (interpretation.userAct === "confirmation" ||
      interpretation.userAct === "correction" ||
      isAffirmativeWriteConfirm(message))
  ) {
    return true;
  }
  const t = norm(message);
  return /\bconfirmo\b/.test(t) && /\b(pero|sin\s+embargo|aunque)\b/.test(t);
}

export function isAwaitingWriteConfirmation(state: ConversationStateV3): boolean {
  return Boolean(state.pendingWrite) || state.lastQuestion?.expected === "confirmation";
}

function clarifyDecision(
  reasoning: string,
  question: string,
  i: TurnInterpretation,
  baseIntent: TurnDecision["stateIntent"],
): TurnDecision {
  return {
    action: "clarify",
    reasoning,
    authorizedCapabilities: [],
    conversationalAct: "ask",
    stateIntent: baseIntent,
    responseGoal: {
      purpose: "clarify",
      facts: [],
      nextQuestion: question,
    },
    confidence: i.confidence,
    interpretationSummary: i.normalizedMeaning,
  };
}

function fieldsFromCorrections(
  interpretation: TurnInterpretation,
): TurnDecision["suppliedFields"] | undefined {
  const fields: Record<string, unknown> = {};
  for (const c of interpretation.corrections) {
    if (c.value !== undefined) {
      fields[c.field] = c.value;
    }
  }
  return Object.keys(fields).length ? fields : undefined;
}

function buildWhatIfAnswer(state: ConversationStateV3): string {
  if (!state.pendingWrite) return NO_PENDING_CONFIRM_MESSAGE;
  const task = state.pendingWrite.task;
  const summary = state.pendingWrite.summary as Record<string, unknown>;
  const plate = summary.plate ?? summary.movilId ?? "la unidad";
  switch (task) {
    case "certificate":
      return `Si confirmás, emito el certificado para ${plate} con los datos que tenemos. Respondé CONFIRMO o CANCELAR.`;
    case "odometer":
      return `Si confirmás, actualizo el odómetro de ${plate}. Respondé CONFIRMO o CANCELAR.`;
    case "hourmeter":
      return `Si confirmás, actualizo el horómetro de ${plate}. Respondé CONFIRMO o CANCELAR.`;
    case "maintenance":
      return `Si confirmás, registro el mantenimiento pendiente. Respondé CONFIRMO o CANCELAR.`;
    case "human_handoff":
      return `Si confirmás, creo el ticket de soporte. Respondé CONFIRMO o CANCELAR.`;
    default:
      return `Si confirmás, ejecuto el trámite pendiente. Respondé CONFIRMO o CANCELAR.`;
  }
}

function looksLikeConfirmationTurn(
  message: string,
  i: TurnInterpretation,
): boolean {
  return (
    i.userAct === "confirmation" ||
    i.relation === "confirm" ||
    isAffirmativeWriteConfirm(message) ||
    isConfirmationQuestion(message) ||
    isConfirmWithCorrection(message, i)
  );
}

/**
 * Resuelve intentos de confirmación sin pending, duplicados, stale o preguntas
 * sobre confirmar. Retorna null si el guard no aplica (flujo normal).
 */
export function resolveConfirmationGuard(input: {
  state: ConversationStateV3;
  message: string;
  interpretation: TurnInterpretation;
  baseIntent: TurnDecision["stateIntent"];
}): TurnDecision | null {
  const { state, message, interpretation: i, baseIntent } = input;

  if (!looksLikeConfirmationTurn(message, i)) return null;

  const awaiting = isAwaitingWriteConfirmation(state);
  const vnext = migrateV3ToVNext(state);
  const focused = vnext.tasks.find((t) => t.id === vnext.focusedTaskId);

  if (isConfirmationQuestion(message) && i.userAct !== "confirmation") {
    return clarifyDecision(
      "Pregunta sobre efecto de confirmar.",
      buildWhatIfAnswer(state),
      i,
      baseIntent,
    );
  }

  if (isConfirmWithCorrection(message, i)) {
    if (awaiting) {
      const taskType =
        state.pendingWrite?.task ?? state.activeTask?.type ?? focused?.type ?? null;
      return {
        action: "execute",
        reasoning:
          "Confirmación con corrección: actualizar datos antes de confirmar.",
        authorizedCapabilities: [],
        conversationalAct: "continue_task",
        task: taskType as TurnDecision["task"],
        taskAction: "continue",
        suppliedFields: fieldsFromCorrections(i),
        stateIntent: baseIntent,
        responseGoal: { purpose: "ask_missing", facts: [], nextQuestion: null },
        confidence: i.confidence,
        interpretationSummary: i.normalizedMeaning,
      };
    }
    return clarifyDecision(
      "Corrección sin operación pendiente.",
      NO_PENDING_CONFIRM_MESSAGE,
      i,
      baseIntent,
    );
  }

  if (awaiting) {
    const targetId = i.confirmation?.targetOperationId;
    if (
      targetId &&
      state.pendingWrite &&
      state.pendingWrite.operationId !== targetId
    ) {
      return clarifyDecision(
        "Confirmación de versión anterior.",
        STALE_CONFIRM_MESSAGE,
        i,
        baseIntent,
      );
    }
    return null;
  }

  if (
    !isAffirmativeWriteConfirm(message) &&
    i.userAct !== "confirmation" &&
    i.relation !== "confirm"
  ) {
    return null;
  }

  if (
    focused?.status === "cancelled" ||
    state.activeTask?.status === "cancelled"
  ) {
    return clarifyDecision(
      "Confirmación de operación cancelada.",
      STALE_CONFIRM_MESSAGE,
      i,
      baseIntent,
    );
  }

  if (focused?.status === "completed") {
    return clarifyDecision(
      "Confirmación duplicada.",
      DUPLICATE_CONFIRM_MESSAGE,
      i,
      baseIntent,
    );
  }

  return clarifyDecision(
    "Confirmación sin operación pendiente.",
    NO_PENDING_CONFIRM_MESSAGE,
    i,
    baseIntent,
  );
}
