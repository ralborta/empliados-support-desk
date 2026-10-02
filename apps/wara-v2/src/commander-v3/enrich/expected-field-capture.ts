/**
 * Captura de campo esperado (post-LLM): rellena unitReference / suppliedFields
 * SOLO cuando lastQuestion.expected ya pide ese campo. No elige trámite.
 */
import {
  extractUnitNameCode,
  filterUnitsByUnitName,
} from "../../pilot/unit-fleet.js";
import {
  isPlausibleVehiclePlate,
  normalizeLoosePlate,
} from "../../pilot/plates.js";
import type { ConversationStateV3 } from "../types/state.js";
import type { TurnPlan } from "../types/turn-plan.js";
import { extractFleetFilterHint } from "./gps-unit-from-message.js";

function ensureCap(
  plan: TurnPlan,
  name: string,
  params: Record<string, unknown> = {},
): TurnPlan {
  if (plan.requestedCapabilities.some((c) => c.name === name)) return plan;
  return {
    ...plan,
    requestedCapabilities: [...plan.requestedCapabilities, { name, params }],
  };
}

function taskAfterUnitCapture(
  plan: TurnPlan,
  state: ConversationStateV3,
): TurnPlan["task"] {
  if (plan.task) return plan.task;
  if (state.activeTask?.type) return state.activeTask.type;
  const purpose = state.pendingEntity?.purpose;
  if (
    purpose === "gps" ||
    purpose === "odometer" ||
    purpose === "hourmeter" ||
    purpose === "certificate"
  ) {
    return purpose;
  }
  return null;
}

function ensureTaskCapsAfterUnit(
  plan: TurnPlan,
  state: ConversationStateV3,
): TurnPlan {
  const task = plan.task ?? state.activeTask?.type ?? state.pendingEntity?.purpose;
  let next = plan;
  if (task === "odometer" || task === "hourmeter") {
    next = ensureCap(next, `${task}.prepare`);
  } else if (task === "certificate") {
    next = ensureCap(next, "certificate.prepare");
  } else if (task === "maintenance") {
    next = ensureCap(next, "maintenance.prepare");
  } else if (task === "human_handoff") {
    next = ensureCap(next, "handoff.prepare");
  } else if (task === "gps") {
    next = ensureCap(next, "gps.get_status");
  }
  return next;
}

export function enrichPlanForExpectedFields(
  plan: TurnPlan,
  state: ConversationStateV3,
  message: string,
): TurnPlan {
  const expected = state.lastQuestion?.expected;
  if (!expected) return plan;
  const t = message.trim();
  if (!t) return plan;

  if (expected === "unit") {
    return enrichExpectedUnit(plan, state, t);
  }

  if (expected === "value") {
    const m = t.match(/^(\d+(?:[.,]\d+)?)$/);
    if (!m) return plan;
    const value = Number(m[1]!.replace(",", "."));
    if (!Number.isFinite(value)) return plan;
    const meter =
      state.activeTask?.type === "hourmeter" ? "hourmeter" : "odometer";
    let next: TurnPlan = {
      ...plan,
      conversationalAct: "continue_task",
      task: plan.task ?? state.activeTask?.type ?? meter,
      taskAction: "continue",
      suppliedFields: { ...(plan.suppliedFields ?? {}), value },
      responseGoal: {
        purpose: "ask_missing",
        facts: (plan.responseGoal.facts ?? []).filter(
          (f) => !/Dejamos pendiente/i.test(f),
        ),
        nextQuestion: null,
      },
      reasoning:
        plan.reasoning ||
        `El usuario aportó el valor ${value} pedido para el medidor.`,
    };
    next = ensureCap(next, `${meter}.prepare`);
    return next;
  }

  // Detalle libre pedido (mantenimiento / handoff): el mensaje ES el campo.
  if (expected === "free_text") {
    const purpose = state.lastQuestion?.purpose ?? "";
    if (
      purpose === "maintenance_detail" ||
      (state.activeTask?.type === "maintenance" &&
        state.activeTask.status === "collecting" &&
        state.activeTask.collected?.detail == null)
    ) {
      let next: TurnPlan = {
        ...plan,
        conversationalAct: "continue_task",
        task: "maintenance",
        taskAction: "continue",
        suppliedFields: { ...(plan.suppliedFields ?? {}), detail: t },
        requestedCapabilities: plan.requestedCapabilities.filter(
          (c) => c.name !== "gps.get_status" && c.name !== "unit.search",
        ),
        responseGoal: {
          purpose: "ask_missing",
          facts: (plan.responseGoal.facts ?? []).filter(
            (f) => !/Dejamos pendiente|aclaraci[oó]n puntual/i.test(f),
          ),
          nextQuestion: null,
        },
        reasoning:
          plan.reasoning ||
          "El usuario aportó el detalle pedido para el mantenimiento.",
      };
      next = ensureCap(next, "maintenance.prepare");
      return next;
    }
    if (
      purpose === "handoff_detail" ||
      (state.activeTask?.type === "human_handoff" &&
        state.activeTask.status === "collecting" &&
        state.activeTask.collected?.detail == null)
    ) {
      let next: TurnPlan = {
        ...plan,
        conversationalAct: "continue_task",
        task: "human_handoff",
        taskAction: "continue",
        suppliedFields: { ...(plan.suppliedFields ?? {}), detail: t },
        requestedCapabilities: plan.requestedCapabilities.filter(
          (c) => c.name !== "gps.get_status",
        ),
        responseGoal: {
          purpose: "ask_missing",
          facts: [],
          nextQuestion: null,
        },
        reasoning:
          plan.reasoning ||
          "El usuario aportó el motivo pedido para la derivación.",
      };
      next = ensureCap(next, "handoff.prepare");
      return next;
    }
  }

  return plan;
}

/** Si mid-odo pide km y el mensaje es solo número, capturar aunque el LLM mienta el act. */
export function enrichPlanForMeterValueFallback(
  plan: TurnPlan,
  state: ConversationStateV3,
  message: string,
): TurnPlan {
  if (
    state.activeTask?.type !== "odometer" &&
    state.activeTask?.type !== "hourmeter"
  ) {
    return plan;
  }
  if (state.activeTask.status !== "collecting" || state.pendingWrite) {
    return plan;
  }
  if (state.activeTask.collected?.value != null) return plan;
  if (plan.suppliedFields?.value != null) return plan;

  const t = message.trim();
  const m = t.match(/^(\d+(?:[.,]\d+)?)$/);
  if (!m) return plan;
  const value = Number(m[1]!.replace(",", "."));
  if (!Number.isFinite(value)) return plan;

  const meter = state.activeTask.type;
  let next: TurnPlan = {
    ...plan,
    conversationalAct: "continue_task",
    task: meter,
    taskAction: "continue",
    suppliedFields: { ...(plan.suppliedFields ?? {}), value },
    responseGoal: {
      purpose: "ask_missing",
      facts: (plan.responseGoal.facts ?? []).filter(
        (f) => !/Dejamos pendiente/i.test(f),
      ),
      nextQuestion: null,
    },
    reasoning:
      plan.reasoning ||
      `Fallback: valor ${value} en mensaje numérico durante recolección de ${meter}.`,
  };
  next = ensureCap(next, `${meter}.prepare`);
  return next;
}

function enrichExpectedUnit(
  plan: TurnPlan,
  state: ConversationStateV3,
  t: string,
): TurnPlan {
  const idx = /^(\d{1,2})$/.exec(t);
  if (idx) {
    let next: TurnPlan = {
      ...plan,
      conversationalAct:
        plan.conversationalAct === "greet" ? "continue_task" : plan.conversationalAct,
      task: taskAfterUnitCapture(plan, state),
      taskAction: plan.taskAction ?? "continue",
      unitReference: {
        kind: "unit",
        mode: "index",
        value: idx[1]!,
        reference: null,
      },
      reasoning:
        plan.reasoning ||
        `El usuario eligió la opción ${idx[1]} del listado de unidades.`,
      responseGoal: {
        purpose: "ask_missing",
        facts: [],
        nextQuestion: null,
      },
    };
    next = ensureCap(next, "unit.select");
    return ensureTaskCapsAfterUnit(next, state);
  }

  const plateNorm = normalizeLoosePlate(t);
  if (plateNorm && isPlausibleVehiclePlate(plateNorm)) {
    let next: TurnPlan = {
      ...plan,
      conversationalAct: "continue_task",
      task: taskAfterUnitCapture(plan, state),
      taskAction: "continue",
      unitReference: {
        kind: "unit",
        mode: "plate",
        value: plateNorm,
        reference: null,
      },
      reasoning: plan.reasoning || `El usuario indicó la patente ${plateNorm}.`,
      responseGoal: {
        purpose: "ask_missing",
        facts: [],
        nextQuestion: null,
      },
    };
    next = ensureCap(next, "unit.select");
    return ensureTaskCapsAfterUnit(next, state);
  }

  const code = extractUnitNameCode(t) ?? (t.length >= 5 && t.length <= 7 ? t : null);
  if (code) {
    const fleetLike = state.fleetCache.map((u) => ({
      movil_id: u.movilId,
      unidad: u.name,
      patente: u.plate,
    }));
    const hits = filterUnitsByUnitName(fleetLike as never, code);
    if (hits.length === 1 || state.fleetCache.length > 0) {
      let next: TurnPlan = {
        ...plan,
        conversationalAct: "continue_task",
        task: taskAfterUnitCapture(plan, state),
        taskAction: "continue",
        unitReference: {
          kind: "unit",
          mode: "unit_name",
          value: t.replace(/\s+/g, ""),
          reference: null,
        },
        reasoning:
          plan.reasoning ||
          `El usuario indicó el código de unidad ${t}.`,
        responseGoal: {
          purpose: "ask_missing",
          facts: [],
          nextQuestion: null,
        },
      };
      next = ensureCap(next, "unit.select");
      return ensureTaskCapsAfterUnit(next, state);
    }
  }

  // Marca / prefijo / nombre corto (“la nissan”, “AG”, “NISSAN”)
  // También en frases largas (“reporte de la saveiro”).
  let hint = t.replace(/^(la|el|esa|ese|las|los)\s+/i, "").trim();
  if (
    !(
      hint &&
      hint.length >= 2 &&
      hint.length <= 24 &&
      hint.split(/\s+/).length <= 3 &&
      !/[?]/.test(hint)
    )
  ) {
    hint = extractFleetFilterHint(t, state) ?? "";
  }
  if (
    hint &&
    hint.length >= 2 &&
    hint.length <= 24 &&
    hint.split(/\s+/).length <= 3 &&
    !/[?]/.test(hint)
  ) {
    let next: TurnPlan = {
      ...plan,
      conversationalAct: "continue_task",
      task: taskAfterUnitCapture(plan, state),
      taskAction: "continue",
      unitReference: {
        kind: "unit",
        mode: "named",
        value: hint,
        reference: null,
      },
      reasoning:
        plan.reasoning ||
        `El usuario indicó la unidad por marca/nombre «${hint}».`,
      responseGoal: {
        purpose: "ask_missing",
        facts: [],
        nextQuestion: null,
      },
    };
    next = ensureCap(next, "unit.select");
    return ensureTaskCapsAfterUnit(next, state);
  }

  return plan;
}
