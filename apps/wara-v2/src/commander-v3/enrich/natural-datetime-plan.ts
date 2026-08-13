/**
 * Post-plan: normaliza fechas naturales y corrige cancel mal etiquetado
 * (paridad V2 natural-datetime + coerce cancel→amend).
 * No elige intención: solo reescribe suppliedFields / acto cuando hay ancla temporal.
 */
import {
  DEFAULT_TENANT_TZ,
  resolveNaturalReadingDatetime,
} from "../../pilot/semantic/natural-datetime.js";
import type { ConversationStateV3 } from "../types/state.js";
import type { TurnPlan } from "../types/turn-plan.js";

function norm(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function isUnequivocalCancel(message: string): boolean {
  const t = norm(message);
  return /^(cancelo|cancelar|cancela|dejalo|dejálo|olvidalo|olvidalo)\b/.test(t);
}

function meterPending(state: ConversationStateV3): boolean {
  const t = state.pendingWrite?.task ?? "";
  return t.includes("odometer") || t.includes("hourmeter");
}

/**
 * Enriquece el TurnPlan con fecha/hora naturales y convierte cancel→amend
 * cuando el mensaje es corrección de fecha del resumen (mo hoy / no hoy / etc.).
 */
export function enrichPlanWithNaturalDatetime(
  plan: TurnPlan,
  state: ConversationStateV3,
  message: string,
  opts?: { timezone?: string; localNow?: string },
): TurnPlan {
  const timezone = opts?.timezone ?? DEFAULT_TENANT_TZ;
  const localNow = opts?.localNow;
  const resolved = resolveNaturalReadingDatetime(message, { timezone, localNow });

  let next = plan;

  // Captura de fecha/hora esperada o prepare: rellenar fields desde resolución natural.
  const expectingDateTime =
    state.lastQuestion?.expected === "date" ||
    state.lastQuestion?.expected === "time" ||
    (state.activeTask?.type === "odometer" || state.activeTask?.type === "hourmeter");

  if (
    expectingDateTime &&
    resolved.kind === "resolved" &&
    resolved.date &&
    (next.conversationalAct === "continue_task" ||
      next.conversationalAct === "amend_task" ||
      next.conversationalAct === "start_task" ||
      next.conversationalAct === "ask" ||
      next.taskAction === "continue" ||
      next.taskAction === "amend")
  ) {
    next = {
      ...next,
      suppliedFields: {
        ...(next.suppliedFields ?? {}),
        date: resolved.date,
        time: resolved.time ?? next.suppliedFields?.time ?? null,
      },
    };
  }

  // Cancel + pending meter + corrección de fecha → amend (no cancel).
  const cancelSignal =
    next.conversationalAct === "cancel_task" || next.taskAction === "cancel";
  if (
    cancelSignal &&
    meterPending(state) &&
    !isUnequivocalCancel(message) &&
    resolved.kind === "resolved" &&
    resolved.date &&
    (resolved.source === "relative" ||
      resolved.source === "weekday" ||
      resolved.source === "numeric")
  ) {
    next = {
      ...next,
      conversationalAct: "amend_task",
      taskAction: "amend",
      task:
        state.pendingWrite?.task?.includes("hourmeter")
          ? "hourmeter"
          : state.activeTask?.type === "hourmeter"
            ? "hourmeter"
            : "odometer",
      amendment: { target: resolved.time ? "time" : "date" },
      suppliedFields: {
        ...(next.suppliedFields ?? {}),
        date: resolved.date,
        time: resolved.time ?? next.suppliedFields?.time ?? null,
      },
      stateIntent: {
        preserveCompany: true,
        preserveUnit: true,
        preserveTask: true,
      },
      responseGoal: {
        purpose: "ask_missing",
        facts: next.responseGoal.facts ?? [],
        nextQuestion: null,
      },
    };
  }

  return next;
}
