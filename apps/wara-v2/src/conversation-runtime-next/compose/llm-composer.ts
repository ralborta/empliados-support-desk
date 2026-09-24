import { authorizedOpenAiFetch } from "../../llm/network.js";
import { FIXED_OPENAI_ENDPOINT } from "../../llm/flags.js";
import { runtimeNextModelName } from "../flags.js";
import type { TurnDecision } from "../types/decision.js";
import type { TurnInterpretation } from "../types/interpretation.js";
import type { ConversationStateVNext } from "../state/vnext-types.js";
import {
  composeReplyDeterministic,
  type ComposeInput,
  extractProtectedBlocks,
} from "./composer.js";

const COMPOSER_SYSTEM = `Sos Atilio (WARA) en WhatsApp. Redactás la respuesta FINAL al usuario.

Recibes: userMessage, interpretation, decision (FIJA — no la modifiques), facts operativos, bloques protegidos.

Reglas estrictas:
- Contestá lo que el usuario preguntó AHORA (interpretation.normalizedMeaning).
- Español rioplatense, cálido, una pregunta por turno si hace falta.
- Los bloques protegidos (listados, confirmaciones, reportes, IDs, formularios) deben copiarse EXACTOS si aparecen en facts.
- NO cambies números, patentes, empresas, casos (#…), iconos ni negrita *…*.
- NO inventes datos ni resultados.
- NO agregues trámites, menús completos ni reabras tareas que decision no autoriza.
- NO contradigas decision.action ni decision.conversationalAct.
- Si hay lateral con trámite pendiente, puedes cerrar con una línea suave sin insistir.

Devuelve solo el texto de la respuesta (sin JSON).`;

export async function composeReplyWithLlm(
  input: ComposeInput & {
    env: NodeJS.ProcessEnv;
    userMessage: string;
    lastAssistantReply?: string | null;
  },
): Promise<{ reply: string; usedLlm: boolean; latencyMs: number }> {
  const protectedBlocks = extractProtectedBlocks(input.facts);
  if (protectedBlocks.length && protectedBlocks.length === input.facts.length) {
    const det = composeReplyDeterministic(input);
    return { reply: det, usedLlm: false, latencyMs: 0 };
  }

  const deterministic = composeReplyDeterministic(input);
  const apiKey = input.env.OPENAI_API_KEY?.trim() ?? "";
  if (!apiKey || apiKey.length < 20) {
    return { reply: deterministic, usedLlm: false, latencyMs: 0 };
  }

  if (
    input.decision.action === "clarify" ||
    input.decision.action === "keep_or_close"
  ) {
    return { reply: deterministic, usedLlm: false, latencyMs: 0 };
  }

  const model = runtimeNextModelName(input.env);
  const started = Date.now();
  try {
    const result = await authorizedOpenAiFetch(FIXED_OPENAI_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.32,
        messages: [
          { role: "system", content: COMPOSER_SYSTEM },
          {
            role: "user",
            content: JSON.stringify({
              userMessage: input.userMessage,
              lastAssistantReply: input.lastAssistantReply ?? null,
              interpretation: {
                normalizedMeaning: input.interpretation.normalizedMeaning,
                userAct: input.interpretation.userAct,
                relation: input.interpretation.relation,
              },
              decision: {
                action: input.decision.action,
                conversationalAct: input.decision.conversationalAct,
                task: input.decision.task ?? null,
                purpose: input.decision.responseGoal.purpose,
                nextQuestion: input.decision.responseGoal.nextQuestion ?? null,
              },
              facts: input.facts,
              protectedBlocks,
              company: input.state.company?.name ?? null,
              unit: input.state.unit?.label ?? null,
              focusedTask: input.state.focusedTaskId
                ? input.state.tasks.find((t) => t.id === input.state.focusedTaskId)?.type
                : null,
            }),
          },
        ],
      }),
      timeoutMs: Number(input.env.WARA_CONVERSATION_RUNTIME_NEXT_COMPOSE_TIMEOUT_MS ?? "18000"),
    });
    if (result.status < 200 || result.status >= 300) {
      return { reply: deterministic, usedLlm: false, latencyMs: Date.now() - started };
    }
    const body = JSON.parse(result.text) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    let text = body.choices?.[0]?.message?.content?.trim() ?? "";
    if (!text) {
      return { reply: deterministic, usedLlm: false, latencyMs: Date.now() - started };
    }
  // Reinsert protected blocks if LLM dropped them
    for (const block of protectedBlocks) {
      if (!text.includes(block.slice(0, 40))) {
        text = `${text}\n\n${block}`;
      }
    }
    return { reply: text.trim(), usedLlm: true, latencyMs: Date.now() - started };
  } catch {
    return { reply: deterministic, usedLlm: false, latencyMs: Date.now() - started };
  }
}
