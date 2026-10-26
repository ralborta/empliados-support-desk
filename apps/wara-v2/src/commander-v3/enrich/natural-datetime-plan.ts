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

function ensurePrepare(plan: TurnPlan, meter: "odometer" | "hourmeter"): TurnPlan {
  const name = `${meter}.prepare`;
  if (plan.requestedCapabilities.some((c) => c.name === name)) return plan;
  return {
    ...plan,
    requestedCapabilities: [...plan.requestedCapabilities, { name, params: {} }],
  };
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

  const meterType =
    state.activeTask?.type === "hourmeter"
      ? "hourmeter"
      : state.activeTask?.type === "odometer"
        ? "odometer"
        : plan.task === "hourmeter"
          ? "hourmeter"
          : plan.task === "odometer"
            ? "odometer"
            : null;

  const expectingDateTime =
    state.lastQuestion?.expected === "date" ||
    state.lastQuestion?.expected === "time" ||
    Boolean(
      meterType &&
        (state.activeTask?.missing?.includes("date") ||
          state.activeTask?.missing?.includes("time")),
    );

  // Captura de fecha/hora: la resolución natural gana al LLM (weekday/relative).
  // No depende del acto: si el LLM pone "inform"/"greet" igual hay que capturar.
  if (
    expectingDateTime &&
    resolved.kind === "resolved" &&
    resolved.date &&
    next.conversationalAct !== "cancel_task" &&
    next.conversationalAct !== "confirm_write" &&
    next.conversationalAct !== "farewell"
  ) {
    const meter = meterType ?? "odometer";
    next = {
      ...next,
      conversationalAct: "continue_task",
      task: next.task ?? state.activeTask?.type ?? meter,
      taskAction: "continue",
      suppliedFields: {
        ...(next.suppliedFields ?? {}),
        date: resolved.date,
        time: resolved.time ?? next.suppliedFields?.time ?? null,
      },
      responseGoal: {
        purpose: "ask_missing",
        facts: [],
        nextQuestion: null,
      },
      reasoning:
        next.reasoning ||
        `Fecha/hora natural resuelta: ${resolved.date}${resolved.time ? ` ${resolved.time}` : ""}.`,
    };
    next = ensurePrepare(next, meter);
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
