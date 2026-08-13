/**
 * Con pendingWrite / expected=confirmation: si el usuario pide OTRO trámite
 * (no CONFIRMO/CANCELAR), forzar switch_task. Evita re-pedir el mismo CONFIRMO.
 *
 * Solo aplica con confirmación pendiente (contrato de speech-act, no routing libre).
 */
import type { ConversationStateV3, TaskTypeV3 } from "../types/state.js";
import type { TurnPlan } from "../types/turn-plan.js";
import {
  isConfirmationReject,
  isUnequivocalWriteConfirm,
} from "./confirmation-outcome.js";

function norm(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function pendingTaskFamily(state: ConversationStateV3): string {
  const t = String(state.pendingWrite?.task ?? state.activeTask?.type ?? "");
  return t.toLowerCase();
}

/** Trámite distinto al pendiente, inferido del mensaje del usuario bajo confirmación. */
export function alternateTaskWhileConfirmPending(
  message: string,
  state: ConversationStateV3,
): TaskTypeV3 | null {
  if (isUnequivocalWriteConfirm(message) || isConfirmationReject(message)) {
    return null;
  }
  const awaiting =
    state.lastQuestion?.expected === "confirmation" || Boolean(state.pendingWrite);
  if (!awaiting) return null;

  const t = norm(message);
  if (!t) return null;

  let next: TaskTypeV3 | null = null;
  if (/\b(od[oó]metro|odometro|odo)\b/.test(t) || /\bkm\b/.test(t)) {
    next = "odometer";
  } else if (/\b(hor[oó]metro|horometro|horo)\b/.test(t)) {
    next = "hourmeter";
  } else if (
    /\b(gps|ubicaci[oó]n|reporte)\b/.test(t) &&
    !/\bcertificado\b/.test(t)
  ) {
    next = "gps";
  } else if (/\b(mantenimiento|service|taller)\b/.test(t)) {
    next = "maintenance";
  } else if (/\b(certificado|cobertura)\b/.test(t)) {
    next = "certificate";
  }

  if (!next) return null;
  const pending = pendingTaskFamily(state);
  if (pending.includes(String(next))) return null;
  if (state.activeTask?.type === next) return null;
  return next;
}

function prepareCapFor(task: TaskTypeV3): string | null {
  switch (task) {
    case "odometer":
      return "odometer.prepare";
    case "hourmeter":
      return "hourmeter.prepare";
    case "certificate":
      return "certificate.prepare";
    case "maintenance":
      return "maintenance.prepare";
    case "gps":
      return "gps.get_status";
    default:
      return null;
  }
}

/**
 * Si hay confirmación pendiente y el mensaje pide otro trámite → switch_task + prepare.
 * Si el plan re-pide el mismo prepare del pendiente → lo saca (evita loop CONFIRMO).
 */
export function enrichPlanForPendingConfirmSwitch(
  plan: TurnPlan,
  state: ConversationStateV3,
  message: string,
): TurnPlan {
  const awaiting =
    state.lastQuestion?.expected === "confirmation" || Boolean(state.pendingWrite);
  if (!awaiting) return plan;
  if (isUnequivocalWriteConfirm(message) || isConfirmationReject(message)) {
    return plan;
  }

  const alt = alternateTaskWhileConfirmPending(message, state);
  if (alt) {
    const prep = prepareCapFor(alt);
    const caps = (plan.requestedCapabilities ?? []).filter((c) => {
      if (!prep) return true;
      // quitar prepare del trámite viejo / commits
      return (
        !c.name.endsWith(".prepare") &&
        !c.name.endsWith(".issue") &&
        !c.name.endsWith(".update") &&
        c.name !== "maintenance.create" &&
        c.name !== "handoff.create"
      );
    });
    if (prep && !caps.some((c) => c.name === prep)) {
      caps.push({ name: prep, params: {} });
    }
    return {
      ...plan,
      conversationalAct: "switch_task",
      task: alt,
      taskAction: "switch",
      requestedCapabilities: caps,
      stateIntent: {
        ...plan.stateIntent,
        preserveCompany: true,
        preserveUnit: true,
        preserveTask: true,
      },
      responseGoal: {
        purpose: "ask_missing",
        facts: plan.responseGoal.facts ?? [],
        nextQuestion: null,
      },
      reasoning:
        (plan.reasoning ? `${plan.reasoning} ` : "") +
        `Confirmación pendiente de otro trámite: el usuario pidió ${alt} → switch_task.`,
      confidence: Math.max(plan.confidence ?? 0.5, 0.9),
    };
  }

  // Sin otro trámite: no re-ejecutar el mismo *.prepare del pending (loop CONFIRMO).
  const pending = pendingTaskFamily(state);
  const stripped = plan.requestedCapabilities.filter((c) => {
    if (pending.includes("certificate") && c.name === "certificate.prepare") {
      return false;
    }
    if (pending.includes("odometer") && c.name === "odometer.prepare") {
      return false;
    }
    if (pending.includes("hourmeter") && c.name === "hourmeter.prepare") {
      return false;
    }
    if (pending.includes("maintenance") && c.name === "maintenance.prepare") {
      return false;
    }
    if (pending.includes("handoff") && c.name === "handoff.prepare") {
      return false;
    }
    return true;
  });

  if (stripped.length !== plan.requestedCapabilities.length) {
    return {
      ...plan,
      requestedCapabilities: stripped,
      conversationalAct:
        plan.conversationalAct === "confirm_write"
          ? plan.conversationalAct
          : "inform",
      responseGoal: {
        purpose: "clarify",
        facts: [],
        nextQuestion:
          "Hay una confirmación pendiente. Respondé CONFIRMO, CANCELAR, o pedime otro trámite (odómetro, GPS, etc.).",
      },
      reasoning:
        (plan.reasoning ? `${plan.reasoning} ` : "") +
        "Evíto re-preparar el mismo trámite pendiente de CONFIRMO.",
    };
  }

  return plan;
}
