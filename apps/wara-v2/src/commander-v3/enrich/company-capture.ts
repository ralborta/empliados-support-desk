/**
 * Captura de empresa esperada (expected-field): índice/nombre → company.select.
 * No elige intención libre: solo aplica cuando ya pedimos empresa o no hay activa.
 */
import type { ConversationStateV3 } from "../types/state.js";
import type { TurnPlan } from "../types/turn-plan.js";

function norm(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function enrichPlanForCompanyCapture(
  plan: TurnPlan,
  state: ConversationStateV3,
  message: string,
): TurnPlan {
  const capturing =
    state.lastQuestion?.expected === "company" ||
    state.pendingEntity?.type === "company" ||
    state.lastListing?.kind === "companies" ||
    // Sin empresa activa: un índice suelto es selección del menú disponible
    (!state.company &&
      state.availableCompanies.length > 1 &&
      /^\d{1,2}$/.test(message.trim()));

  if (!capturing) return plan;

  const t = message.trim();
  if (!t) return plan;

  const idx = /^(\d{1,2})$/.exec(t);
  if (idx) {
    const n = Number.parseInt(idx[1]!, 10);
    let companyId: string | undefined;
    if (state.lastListing?.kind === "companies") {
      companyId = state.lastListing.items.find((i) => i.index === n)?.companyId;
    }
    if (!companyId) {
      companyId = state.availableCompanies[n - 1]?.id;
    }
    return {
      ...plan,
      conversationalAct: "inform",
      task: null,
      taskAction: null,
      companyReference: {
        kind: "company",
        mode: "index",
        value: idx[1]!,
        reference: null,
      },
      requestedCapabilities: [
        {
          name: "company.select",
          params: companyId ? { companyId } : {},
        },
      ],
      responseGoal: {
        purpose: "inform",
        facts: [],
        nextQuestion: null,
      },
      stateIntent: {
        preserveCompany: false,
        preserveUnit: true,
        preserveTask: true,
      },
      reasoning:
        plan.reasoning ||
        `El usuario eligió la opción ${idx[1]} del listado de empresas.`,
    };
  }

  const q = norm(t);
  const match = state.availableCompanies.find(
    (c) =>
      norm(c.name) === q ||
      norm(c.name).includes(q) ||
      c.id === t,
  );
  if (match) {
    return {
      ...plan,
      conversationalAct: "inform",
      task: null,
      taskAction: null,
      companyReference: {
        kind: "company",
        mode: "named",
        value: match.name,
        reference: null,
      },
      requestedCapabilities: [
        { name: "company.select", params: { companyId: match.id } },
      ],
      responseGoal: {
        purpose: "inform",
        facts: [],
        nextQuestion: null,
      },
      stateIntent: {
        preserveCompany: false,
        preserveUnit: true,
        preserveTask: true,
      },
      reasoning:
        plan.reasoning || `El usuario eligió la empresa ${match.name}.`,
    };
  }

  return plan;
}

/** En saludo sin empresa: forzar menú de selección. */
export function enrichPlanForGreetingCompanyGate(
  plan: TurnPlan,
  state: ConversationStateV3,
): TurnPlan {
  if (state.company) return plan;
  if (state.availableCompanies.length <= 1) return plan;
  if (plan.conversationalAct !== "greet" && plan.conversationalAct !== "inform") {
    return plan;
  }
  // Solo al primer saludo / presentación
  const needsAsk =
    plan.conversationalAct === "greet" ||
    !state.conversationMetadata.introducedAtilio;
  if (!needsAsk && plan.conversationalAct !== "greet") return plan;

  if (plan.conversationalAct === "greet") {
    const hasList = plan.requestedCapabilities.some((c) => c.name === "company.list");
    return {
      ...plan,
      requestedCapabilities: hasList
        ? plan.requestedCapabilities
        : [
            ...plan.requestedCapabilities,
            { name: "company.list", params: {} },
          ],
      reasoning:
        (plan.reasoning ? `${plan.reasoning} ` : "") +
        "Sin empresa activa: debo pedir que elija una al saludar.",
      responseGoal: {
        purpose: "ask_missing",
        facts: plan.responseGoal.facts ?? [],
        nextQuestion:
          plan.responseGoal.nextQuestion ??
          "¿Con qué empresa seguimos?",
      },
    };
  }
  return plan;
}
