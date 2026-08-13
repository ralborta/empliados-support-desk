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
        facts: [],
        nextQuestion: null,
      },
      reasoning:
        plan.reasoning ||
        `El usuario aportó el valor ${value} pedido para el medidor.`,
    };
    next = ensureCap(next, `${meter}.prepare`);
    return next;
  }

  return plan;
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
      task: plan.task ?? state.activeTask?.type ?? null,
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
    if (
      state.activeTask?.type === "odometer" ||
      state.activeTask?.type === "hourmeter"
    ) {
      next = ensureCap(next, `${state.activeTask.type}.prepare`);
    }
    return next;
  }

  const plateNorm = normalizeLoosePlate(t);
  if (plateNorm && isPlausibleVehiclePlate(plateNorm)) {
    let next: TurnPlan = {
      ...plan,
      conversationalAct: "continue_task",
      task: plan.task ?? state.activeTask?.type ?? null,
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
    if (
      state.activeTask?.type === "odometer" ||
      state.activeTask?.type === "hourmeter"
    ) {
      next = ensureCap(next, `${state.activeTask.type}.prepare`);
    }
    return next;
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
        task: plan.task ?? state.activeTask?.type ?? null,
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
      if (
        state.activeTask?.type === "odometer" ||
        state.activeTask?.type === "hourmeter"
      ) {
        next = ensureCap(next, `${state.activeTask.type}.prepare`);
      }
      return next;
    }
  }

  return plan;
}
