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

export function isCompanyResetList(plan: TurnPlan): boolean {
  return plan.requestedCapabilities.some(
    (c) =>
      c.name === "company.list" &&
      (c.params?.reset === true || plan.stateIntent?.preserveCompany === false),
  );
}

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
  // Reinicio/cambio explícito: NUNCA strippear company.list.
  if (isCompanyResetList(plan)) return plan;

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

  // Este turno ya elige empresa: no strippear GPS/ops (se ejecutan después del select).
  if (plan.requestedCapabilities.some((c) => c.name === "company.select")) {
    return plan;
  }

  if (!needsCompanyForOps(plan)) return plan;
  if (state.availableCompanies.length <= 1) return plan;

  const unitHint =
    plan.unitReference?.kind === "unit" &&
    plan.unitReference.mode !== "index" &&
    plan.unitReference.mode !== "contextual"
      ? String(plan.unitReference.value ?? "").trim()
      : "";

  const strippedOps = plan.requestedCapabilities.filter((c) => OPS_CAPS.has(c.name));
  const kept = plan.requestedCapabilities.filter(
    (c) => !OPS_CAPS.has(c.name) && c.name !== "company.list",
  );
  const parkedCaps =
    strippedOps.length > 0
      ? strippedOps
      : plan.task === "gps"
        ? [{ name: "gps.get_status", params: {} }]
        : plan.task === "odometer"
          ? [{ name: "odometer.prepare", params: {} }]
          : plan.task === "hourmeter"
            ? [{ name: "hourmeter.prepare", params: {} }]
            : strippedOps;

  const parkedTask =
    plan.task && plan.task !== "unit_query"
      ? plan.task
      : parkedCaps.some((c) => c.name === "gps.get_status")
        ? ("gps" as const)
        : plan.task ?? null;

  const parkedTurn = {
    answerKind: plan.interpretation?.answerKind ?? "status",
    userQuestion: plan.interpretation?.userQuestion ?? "pedido operativo",
    task: parkedTask,
    capabilities: parkedCaps.map((c) => ({
      name: c.name,
      params: c.params ?? {},
    })),
  };

  const alreadyAskingCompany =
    state.lastQuestion?.expected === "company" &&
    state.lastListing?.kind === "companies";

  return {
    ...plan,
    conversationalAct: "ask",
    taskAction: null,
    task: null,
    parkedTurn,
    requestedCapabilities: alreadyAskingCompany
      ? kept
      : [{ name: "company.list", params: {} }, ...kept],
    suppliedFields: {
      ...(plan.suppliedFields ?? {}),
      ...(unitHint ? { unitQuery: unitHint } : {}),
    },
    responseGoal: {
      purpose: "ask_missing",
      facts: [],
      nextQuestion:
        parkedTask === "gps" ||
        parkedCaps.some((c) => c.name === "gps.get_status")
          ? "Elegí la empresa (1/2/nombre) y te paso el estado."
          : "¿Con qué empresa seguimos? (número o nombre)",
    },
    reasoning:
      (plan.reasoning ? `${plan.reasoning} ` : "") +
      "Sin empresa: estaciono la operación, primero la empresa.",
  };
}
