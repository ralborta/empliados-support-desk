import { authorizedOpenAiFetch } from "../../llm/network.js";
import { FIXED_OPENAI_ENDPOINT } from "../../llm/flags.js";
import { commanderV3ModelName } from "../flags.js";
import type { ConversationStateV3 } from "../types/state.js";
import type { TurnPlan } from "../types/turn-plan.js";

const REDACTOR_SYSTEM = `Sos el redactor de Atilio (WARA). Solo redactás la respuesta final.
- Español claro, vos, frases breves para WhatsApp.
- NO inventes hechos. NO agregues tools. NO cambies empresa/unidad.
- NO menús genéricos. NO corrijas ortografía del usuario.
- Usá SOLO los hechos validados y el responseGoal.`;

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
    if (!input.state.conversationMetadata.introducedAtilio) {
      return {
        reply:
          "Hola, soy Atilio, el asistente virtual de WARA. ¿En qué te ayudo?",
        usedLlm: false,
        latencyMs: 0,
      };
    }
    const pending = input.state.activeTask
      ? ` Tenemos pendiente ${labelTask(input.state.activeTask.type)}.`
      : "";
    return {
      reply: `Hola, ¿en qué te ayudo?${pending}`,
      usedLlm: false,
      latencyMs: 0,
    };
  }

  if (input.facts.length === 1 && input.facts[0]!.length < 500) {
    const f = input.facts[0]!;
    if (
      input.plan.responseGoal.nextQuestion &&
      input.plan.responseGoal.purpose === "ask_missing"
    ) {
      return {
        reply: `${f}\n\n${input.plan.responseGoal.nextQuestion}`,
        usedLlm: false,
        latencyMs: 0,
      };
    }
    return { reply: f, usedLlm: false, latencyMs: 0 };
  }

  if (input.facts.length > 1) {
    const joined = input.facts.filter(Boolean).join("\n\n");
    if (joined.length < 900 && input.plan.confidence >= 0.7) {
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
        temperature: 0.2,
        messages: [
          { role: "system", content: REDACTOR_SYSTEM },
          {
            role: "user",
            content: JSON.stringify({
              purpose: input.plan.responseGoal.purpose,
              facts: input.facts,
              nextQuestion: input.plan.responseGoal.nextQuestion ?? null,
              company: input.state.company?.name ?? null,
              unit: input.state.unit?.label ?? null,
              task: input.state.activeTask?.type ?? null,
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
  if (facts.length) return facts.join("\n\n");
  if (plan.responseGoal.nextQuestion) return plan.responseGoal.nextQuestion;
  if (plan.responseGoal.facts.length) return plan.responseGoal.facts.join("\n");
  return "No pude completar esa acción. ¿Me precisás un poco más?";
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
