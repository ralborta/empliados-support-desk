/**
 * Switch de trámite con trabajo a medias:
 * - No hereda value/date/time del trámite anterior
 * - Suspende el anterior (sin pendingWrite: no hubo CONFIRMO)
 * - Avisa que queda pendiente y sigue con el nuevo
 *
 * Solo aplica cuando el TurnPlan ya eligió start/switch a OTRO task.
 */
import type { ConversationStateV3 } from "../types/state.js";
import type { TurnPlan } from "../types/turn-plan.js";
import type { TaskTypeV3 } from "../types/state.js";

function taskLabel(task: string | null | undefined): string {
  switch (task) {
    case "odometer":
      return "odómetro";
    case "hourmeter":
      return "horómetro";
    case "certificate":
      return "certificado";
    case "maintenance":
      return "mantenimiento";
    case "human_handoff":
      return "ticket";
    case "gps":
      return "GPS";
    default:
      return "trámite";
  }
}

const OPERATIONAL_SWITCH_TARGETS = new Set<string>([
  "certificate",
  "odometer",
  "hourmeter",
  "maintenance",
  "gps",
  "human_handoff",
]);

export function isSwitchingTask(
  plan: TurnPlan,
  state: ConversationStateV3,
): boolean {
  if (!plan.task) return false;
  // unit_query no es un trámite operativo: el LLM lo usa al pedirle km/patente
  // y no debe suspender odómetro/cert ("Seguimos con trámite").
  if (!OPERATIONAL_SWITCH_TARGETS.has(plan.task)) return false;

  // Si estamos pidiendo un campo concreto, el mensaje es la respuesta — no un switch.
  const expected = state.lastQuestion?.expected;
  if (
    expected === "value" ||
    expected === "date" ||
    expected === "time" ||
    expected === "free_text"
  ) {
    return false;
  }

  const act =
    plan.conversationalAct === "start_task" ||
    plan.conversationalAct === "switch_task" ||
    plan.taskAction === "start" ||
    plan.taskAction === "switch";
  if (!act) return false;

  if (state.pendingWrite) {
    const pw = String(state.pendingWrite.task);
    if (!pw.includes(String(plan.task))) return true;
  }
  if (state.activeTask && state.activeTask.type !== plan.task) return true;
  return false;
}

/** Estado limpio para ejecutar el nuevo trámite (sin arrastrar collected ajeno). */
export function stateForSwitchedTask(
  state: ConversationStateV3,
  newTask: TaskTypeV3,
): ConversationStateV3 {
  const prev = state.activeTask;
  return {
    ...state,
    suspendedTask: prev
      ? {
          task: {
            ...prev,
            status: "collecting",
          },
          reason: "switch",
        }
      : state.suspendedTask,
    activeTask: {
      type: newTask,
      status: "collecting",
      collected: {},
      missing: [],
    },
    pendingWrite: null,
    lastQuestion: null,
    pendingEntity: null,
  };
}

export function enrichPlanForTaskSwitch(
  plan: TurnPlan,
  state: ConversationStateV3,
): TurnPlan {
  if (!isSwitchingTask(plan, state) || !plan.task) return plan;

  const prevType = state.activeTask?.type ?? state.pendingWrite?.task ?? null;
  const prev = taskLabel(
    typeof prevType === "string" && prevType.includes("odometer")
      ? "odometer"
      : typeof prevType === "string" && prevType.includes("hourmeter")
        ? "hourmeter"
        : typeof prevType === "string" && prevType.includes("certificate")
          ? "certificate"
          : typeof prevType === "string" && prevType.includes("maintenance")
            ? "maintenance"
            : typeof prevType === "string" && prevType.includes("handoff")
              ? "human_handoff"
              : (state.activeTask?.type ?? null),
  );
  const next = taskLabel(plan.task);
  const notice = `Dejamos pendiente el cambio de ${prev} (sin confirmar). Seguimos con ${next}.`;

  const fields = { ...(plan.suppliedFields ?? {}) };
  // No arrastrar medidores del trámite anterior
  delete fields.value;
  delete fields.date;
  delete fields.time;

  return {
    ...plan,
    conversationalAct: "switch_task",
    taskAction: "switch",
    suppliedFields: fields,
    stateIntent: {
      ...plan.stateIntent,
      preserveTask: true,
    },
    responseGoal: {
      purpose: "ask_missing",
      facts: [notice, ...(plan.responseGoal.facts ?? [])],
      nextQuestion: plan.responseGoal.nextQuestion,
    },
    reasoning:
      (plan.reasoning ? `${plan.reasoning} ` : "") +
      `Switch de ${prev} → ${next}: suspendo el anterior sin CONFIRMO y empiezo limpio.`,
  };
}
