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

function matchCompanyByUtterance(
  message: string,
  companies: Array<{ id: string; name: string }>,
): { id: string; name: string } | undefined {
  const q = norm(message);
  if (!q) return undefined;
  const exact = companies.filter(
    (c) =>
      norm(c.name) === q ||
      norm(c.name).includes(q) ||
      q.includes(norm(c.name)) ||
      c.id === message.trim(),
  );
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return undefined;
  const tokenHits = companies.filter((c) => {
    const tokens = norm(c.name)
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 4);
    return tokens.some((t) => q.includes(t));
  });
  return tokenHits.length === 1 ? tokenHits[0] : undefined;
}

/** Al elegir empresa, ejecutar el pedido operativo estacionado (no preguntar de nuevo). */
export function attachParkedOpsAfterCompanySelect(
  plan: TurnPlan,
  state: ConversationStateV3,
): TurnPlan {
  if (!plan.requestedCapabilities.some((c) => c.name === "company.select")) {
    return plan;
  }
  const parked = state.conversationMetadata.parkedTurn;
  const ops = (parked?.capabilities ?? []).filter(
    (c) => c.name !== "company.list" && c.name !== "company.select",
  );
  if (!ops.length) return plan;

  const select = plan.requestedCapabilities.filter(
    (c) => c.name === "company.select",
  );
  const rest = plan.requestedCapabilities.filter(
    (c) =>
      c.name !== "company.select" &&
      !ops.some((o) => o.name === c.name),
  );
  const parkedTask =
    parked?.task && parked.task !== "unit_query" ? parked.task : plan.task;

  return {
    ...plan,
    conversationalAct:
      parkedTask === "gps" ||
      ops.some((c) => c.name === "gps.get_status" || String(c.name).endsWith(".prepare"))
        ? "start_task"
        : plan.conversationalAct === "ask"
          ? "inform"
          : plan.conversationalAct,
    task: parkedTask ?? plan.task,
    taskAction: parkedTask ? "start" : plan.taskAction,
    requestedCapabilities: [...select, ...ops, ...rest],
    parkedTurn: null,
    responseGoal: {
      purpose: "inform",
      facts: [],
      nextQuestion: null,
    },
    reasoning:
      (plan.reasoning ? `${plan.reasoning} ` : "") +
      "Empresa elegida: ejecuto el pedido estacionado.",
  };
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

  if (!capturing) {
    return attachParkedOpsAfterCompanySelect(plan, state);
  }

  const t = message.trim();
  if (!t) return attachParkedOpsAfterCompanySelect(plan, state);

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
    return attachParkedOpsAfterCompanySelect(
      {
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
      },
      state,
    );
  }

  const match = matchCompanyByUtterance(t, state.availableCompanies);
  if (match) {
    return attachParkedOpsAfterCompanySelect(
      {
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
      },
      state,
    );
  }

  return attachParkedOpsAfterCompanySelect(plan, state);
}

/** En saludo sin empresa: forzar menú de selección. */
export function enrichPlanForGreetingCompanyGate(
  plan: TurnPlan,
  state: ConversationStateV3,
): TurnPlan {
  // Empresa ya activa: NUNCA re-listar (evita "Empresas disponibles" mid-flujo),
  // salvo reinicio/cambio explícito (params.reset / preserveCompany=false).
  if (state.company) {
    const isReset = plan.requestedCapabilities.some(
      (c) =>
        c.name === "company.list" &&
        (c.params?.reset === true || plan.stateIntent?.preserveCompany === false),
    );
    if (isReset) return plan;
    const stripped = plan.requestedCapabilities.filter(
      (c) => c.name !== "company.list",
    );
    if (stripped.length !== plan.requestedCapabilities.length) {
      return {
        ...plan,
        requestedCapabilities: stripped,
        reasoning:
          (plan.reasoning ? `${plan.reasoning} ` : "") +
          "Empresa ya activa: quité company.list.",
      };
    }
    return plan;
  }
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
