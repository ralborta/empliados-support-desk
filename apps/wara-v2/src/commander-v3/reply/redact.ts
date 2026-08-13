import { authorizedOpenAiFetch } from "../../llm/network.js";
import { FIXED_OPENAI_ENDPOINT } from "../../llm/flags.js";
import { commanderV3ModelName } from "../flags.js";
import type { ConversationStateV3 } from "../types/state.js";
import type { TurnPlan } from "../types/turn-plan.js";

const REDACTOR_SYSTEM = `Sos Atilio (WARA) escribiendo por WhatsApp.
- Español rioplatense natural: vos, cálido, humano. Como un colega que ayuda, no un formulario.
- NO inventes hechos. NO agregues tools. NO cambies empresa/unidad.
- Usá SOLO los hechos validados (facts) y el responseGoal.
- LISTADOS: si hay un listado numerado en facts, copialo COMPLETO tal cual (todas las líneas 1. 2. 3.…). PROHIBIDO resumir como "tengo el listado" o "¿alguna en particular?" sin pegar las unidades.
- Si el usuario preguntó algo fuera del trámite, respondé eso primero con los facts disponibles; no lo ignores para forzar el flujo.
- Si no hay facts suficientes o no estás seguro, preguntá con naturalidad qué precisan (una sola pregunta).
- Evitá tono robótico. Preferí "¿Cuántos km?", "¿Qué unidad?", "Mandame CONFIRMO y lo grabo".
- NO menús genéricos inventados. NO corrijas ortografía del usuario.`;

function looksLikeListingFact(f: string): boolean {
  const lines = f.split("\n").filter((l) => l.trim());
  const numbered = lines.filter((l) => /^\d+\.\s/.test(l.trim())).length;
  return numbered >= 2 || (/Unidades en/i.test(f) && numbered >= 1);
}

export async function redactReply(input: {
  plan: TurnPlan;
  facts: string[];
  state: ConversationStateV3;
  env: NodeJS.ProcessEnv;
  conflictClarify?: string | null;
}): Promise<{ reply: string; usedLlm: boolean; latencyMs: number }> {
  if (input.conflictClarify) {
    return { reply: input.conflictClarify, usedLlm: false, latencyMs: 0 };
  }

  if (input.plan.conversationalAct === "greet") {
    const intro = !input.state.conversationMetadata.introducedAtilio
      ? "Hola, soy Atilio, el asistente virtual de WARA."
      : "Hola.";
    const companyFacts = input.facts.filter(
      (f) => /empresa/i.test(f) || /^\d+\.\s/.test(f) || /eleg/i.test(f),
    );
    if (!input.state.company && input.state.availableCompanies.length > 1) {
      const fromFacts = companyFacts.length
        ? companyFacts.join("\n\n")
        : `Antes de seguir, elegí la empresa:\n${input.state.availableCompanies
            .map((c, i) => `${i + 1}. ${c.name}`)
            .join("\n")}`;
      return {
        reply: `${intro} ${fromFacts}`,
        usedLlm: false,
        latencyMs: 0,
      };
    }
    if (!input.state.company && input.state.availableCompanies.length === 1) {
      return {
        reply: `${intro} Seguimos con ${input.state.availableCompanies[0]!.name}. ¿En qué te ayudo?`,
        usedLlm: false,
        latencyMs: 0,
      };
    }
    const pending = input.state.activeTask
      ? ` Tenemos pendiente ${labelTask(input.state.activeTask.type)}.`
      : "";
    return {
      reply: `${intro} ¿En qué te ayudo?${pending}`,
      usedLlm: false,
      latencyMs: 0,
    };
  }

  // Hechos validados con listado: no pasar por LLM (evita "tengo el listado" sin ítems).
  if (input.facts.some(looksLikeListingFact)) {
    return {
      reply: fallbackFromFacts(input.facts, input.plan),
      usedLlm: false,
      latencyMs: 0,
    };
  }

  const purpose = input.plan.responseGoal.purpose;
  const wantsNatural =
    purpose === "ask_missing" ||
    purpose === "clarify" ||
    purpose === "resume" ||
    purpose === "confirm_write" ||
    Boolean(input.plan.responseGoal.nextQuestion);

  if (!wantsNatural && input.facts.length === 1 && input.facts[0]!.length < 500) {
    return { reply: input.facts[0]!, usedLlm: false, latencyMs: 0 };
  }

  if (
    !wantsNatural &&
    input.facts.length > 1 &&
    input.plan.confidence >= 0.7
  ) {
    const joined = input.facts.filter(Boolean).join("\n\n");
    if (joined.length < 900) {
      return { reply: joined, usedLlm: false, latencyMs: 0 };
    }
  }

  const model = commanderV3ModelName(input.env);
  const started = Date.now();
  try {
    const apiKey = input.env.OPENAI_API_KEY?.trim() ?? "";
    if (!apiKey) {
      return {
        reply: fallbackFromFacts(input.facts, input.plan),
        usedLlm: false,
        latencyMs: 0,
      };
    }
    const result = await authorizedOpenAiFetch(FIXED_OPENAI_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.4,
        messages: [
          { role: "system", content: REDACTOR_SYSTEM },
          {
            role: "user",
            content: JSON.stringify({
              purpose,
              facts: input.facts,
              nextQuestion: input.plan.responseGoal.nextQuestion ?? null,
              company: input.state.company?.name ?? null,
              unit: input.state.unit?.label ?? null,
              task: input.state.activeTask?.type ?? null,
              act: input.plan.conversationalAct,
              userMessageHint:
                "Respondé de forma humana. Si hay listado en facts, incluilo completo.",
            }),
          },
        ],
      }),
      timeoutMs: 15_000,
    });
    if (result.status < 200 || result.status >= 300) {
      return {
        reply: fallbackFromFacts(input.facts, input.plan),
        usedLlm: false,
        latencyMs: Date.now() - started,
      };
    }
    const body = JSON.parse(result.text) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = body.choices?.[0]?.message?.content?.trim();
    if (!text) {
      return {
        reply: fallbackFromFacts(input.facts, input.plan),
        usedLlm: false,
        latencyMs: Date.now() - started,
      };
    }
    return { reply: text, usedLlm: true, latencyMs: Date.now() - started };
  } catch {
    return {
      reply: fallbackFromFacts(input.facts, input.plan),
      usedLlm: false,
      latencyMs: Date.now() - started,
    };
  }
}

function fallbackFromFacts(facts: string[], plan: TurnPlan): string {
  if (facts.length && plan.responseGoal.nextQuestion) {
    const joined = facts.join("\n\n");
    if (facts.some(looksLikeListingFact)) return joined;
    return `${joined}\n\n${plan.responseGoal.nextQuestion}`;
  }
  if (facts.length) return facts.join("\n\n");
  if (plan.responseGoal.nextQuestion) return plan.responseGoal.nextQuestion;
  if (plan.responseGoal.facts.length) return plan.responseGoal.facts.join("\n");
  return "No pude completar eso. ¿Me contás un poco más?";
}

function labelTask(t: string): string {
  switch (t) {
    case "certificate":
      return "un certificado";
    case "odometer":
      return "un odómetro";
    case "hourmeter":
      return "un horómetro";
    case "maintenance":
      return "un mantenimiento";
    case "human_handoff":
      return "una derivación";
    default:
      return "un trámite";
  }
}
