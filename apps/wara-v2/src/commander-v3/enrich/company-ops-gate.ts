/**
 * Sin empresa activa no se puede cargar flota ni GPS/medidor.
 * Evita el combo tóxico: "No pude cargar flota" + "Empresas disponibles" + "dame patente".
 */
import type { ConversationStateV3 } from "../types/state.js";
import type { TurnPlan } from "../types/turn-plan.js";

const OPS_CAPS = new Set([
  "gps.get_status",
  "unit.search",
  "unit.select",
  "odometer.prepare",
  "hourmeter.prepare",
  "certificate.prepare",
  "maintenance.prepare",
]);

function needsCompanyForOps(plan: TurnPlan): boolean {
  if (
    plan.task === "gps" ||
    plan.task === "unit_query" ||
    plan.task === "odometer" ||
    plan.task === "hourmeter" ||
    plan.task === "certificate" ||
    plan.task === "maintenance"
  ) {
    return true;
  }
  return plan.requestedCapabilities.some((c) => OPS_CAPS.has(c.name));
}

export function enrichPlanForCompanyOpsGate(
  plan: TurnPlan,
  state: ConversationStateV3,
): TurnPlan {
  if (state.company) {
    if (!plan.requestedCapabilities.some((c) => c.name === "company.list")) {
      return plan;
    }
    return {
      ...plan,
      requestedCapabilities: plan.requestedCapabilities.filter(
        (c) => c.name !== "company.list",
      ),
      reasoning:
        (plan.reasoning ? `${plan.reasoning} ` : "") +
        "Empresa ya activa: quité company.list del plan operativo.",
    };
  }

  if (!needsCompanyForOps(plan)) return plan;
  if (state.availableCompanies.length <= 1) return plan;

  const unitHint =
    plan.unitReference?.kind === "unit" &&
    plan.unitReference.mode !== "index" &&
    plan.unitReference.mode !== "contextual"
      ? String(plan.unitReference.value ?? "").trim()
      : "";

  const kept = plan.requestedCapabilities.filter(
    (c) => !OPS_CAPS.has(c.name) && c.name !== "company.list",
  );

  return {
    ...plan,
    taskAction: plan.taskAction ?? "start",
    conversationalAct:
      plan.conversationalAct === "greet" ? "start_task" : plan.conversationalAct,
    requestedCapabilities: [{ name: "company.list", params: {} }, ...kept],
    suppliedFields: {
      ...(plan.suppliedFields ?? {}),
      ...(unitHint ? { unitQuery: unitHint } : {}),
    },
    responseGoal: {
      purpose: "ask_missing",
      facts: [],
      nextQuestion:
        plan.task === "gps" ||
        plan.requestedCapabilities.some((c) => c.name === "gps.get_status")
          ? "¿Con qué empresa seguimos para el reporte?"
          : "¿Con qué empresa seguimos?",
    },
    reasoning:
      (plan.reasoning ? `${plan.reasoning} ` : "") +
      "Sin empresa activa: primero elegir empresa (no flota/GPS todavía).",
  };
}
