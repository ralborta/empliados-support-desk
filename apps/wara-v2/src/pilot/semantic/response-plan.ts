/**
 * Plan de respuesta al cliente — hechos cerrados, sin inventar datos.
 * El texto final puede venir de templates específicas o de un redactor LLM
 * que solo recibe estos hechos (no decide operaciones).
 */
export type ResponsePurpose =
  | "inform"
  | "ask_missing_field"
  | "confirm_write"
  | "clarify"
  | "resume"
  | "greet";

export type ResponsePlan = {
  purpose: ResponsePurpose;
  facts: string[];
  pendingSummary?: string;
  nextQuestion?: string;
};

/** Compone una respuesta WhatsApp breve a partir del plan. */
export function renderResponsePlan(plan: ResponsePlan): string {
  const parts: string[] = [];
  for (const f of plan.facts) {
    const t = f.trim();
    if (t) parts.push(t);
  }
  if (plan.pendingSummary?.trim()) {
    parts.push(plan.pendingSummary.trim());
  }
  if (plan.nextQuestion?.trim()) {
    parts.push(plan.nextQuestion.trim());
  }
  return parts.join(parts.length > 1 ? "\n\n" : "");
}

export function planAskMissingField(opts: {
  received?: string;
  missing: string;
  question: string;
}): ResponsePlan {
  const facts: string[] = [];
  if (opts.received?.trim()) facts.push(opts.received.trim());
  return {
    purpose: "ask_missing_field",
    facts,
    nextQuestion: opts.question,
  };
}

export function planOrchestrationClarify(context: string): ResponsePlan {
  return {
    purpose: "clarify",
    facts: [
      "No pude determinar qué dato falta para avanzar.",
      context.trim() || "Decime qué querés hacer o qué dato completar.",
    ],
  };
}
