import { authorizedOpenAiFetch } from "../../llm/network.js";
import { FIXED_OPENAI_ENDPOINT } from "../../llm/flags.js";
import { commanderV3ModelName } from "../flags.js";
import type { ConversationStateV3 } from "../types/state.js";
import type { TurnPlan } from "../types/turn-plan.js";
import { formatGreeting } from "./format-wa.js";

const REDACTOR_SYSTEM = `Sos Atilio (WARA) escribiendo por WhatsApp.
- Español rioplatense natural: vos, cálido, humano. Como un colega que ayuda, no un formulario ("completá estos campos").
- Te llega interpretation (userQuestion + answerKind + priorReply) y el MENSAJE DEL USUARIO. CONTESTÁ userQuestion con los facts. Primera oración = respuesta a lo que preguntó.
- Si priorReply.relevant, tu respuesta anterior importa: no la ignores ni la reemplaces por un listado.
- Si preguntó algo puntual sobre GPS (si la posición es correcta, si está al día, por qué la ignición), respondé ESO con los tiempos de reporte/posición; no ignores la pregunta ni la reemplaces por un listado.
- NUNCA reemplaces una pregunta (yes_no/status/how_to) con un listado de unidades que no pidió.
- UNA pregunta por turno. No apiles km + fecha + CONFIRMO en el mismo mensaje si los facts piden una sola cosa.
- No repitas el mismo párrafo del turno anterior. No prometas plazos ni "ya te llamamos".
- Si facts traen nro de caso (#…), conservalo tal cual; no inventes otro.
- PROHIBIDO saludar en cada mensaje. NUNCA empieces con "Hola", "Hola ¿cómo estás?", "Buenas" salvo que purpose/act sea saludo explícito.
- NO inventes hechos. NO agregues tools. NO cambies empresa/unidad.
- Usá SOLO los hechos validados (facts) y el responseGoal. Si hay un fact operativo (pedir km, fecha, CONFIRMO, listado, GPS), priorizalo y acortá sin vaciarlo — salvo que answerKind sea una pregunta: entonces la pregunta gana.
- Si los facts ya traen iconos/negrita (*…*) de WhatsApp, conservalos tal cual (no los aplanes a prosa).
- LISTADOS: si answerKind=list y hay un listado numerado en facts, copialo COMPLETO tal cual. PROHIBIDO resumir como "tengo el listado" sin ítems.
- Si el usuario preguntó algo fuera del trámite, respondé con los facts; no digas "no tengo información" si hay facts.
- PROHIBIDO inventar "No tengo información disponible" / "no hay información". Si purpose=ask_missing y hay menú en facts, copiá el menú.
- Si no hay facts, una sola pregunta abierta ("¿Qué necesitás?") — nunca digas que no tenés información.
- NO corrijas ortografía del usuario.`;

function looksLikeListingFact(f: string): boolean {
  const lines = f.split("\n").filter((l) => l.trim());
  const numbered = lines.filter((l) => /^\d+\.\s/.test(l.trim())).length;
  return numbered >= 2 || (/Unidades en/i.test(f) && numbered >= 1);
}

/** Formularios que no puede reescribir el LLM (CONFIRMO, captura de km, menú). */
function looksLikeLockedFormFact(f: string): boolean {
  return /Pasame el valor|Respondé \*CONFIRMO|\*CONFIRMO\* o \*CANCELAR\*|¿Confirmás|Cancelé el trámite|Dejamos pendiente|¿Qué necesitás\?|Dale, seguimos/i.test(
    f,
  );
}

function looksLikeOperationalFact(f: string): boolean {
  if (looksLikeListingFact(f)) return true;
  if (looksLikeLockedFormFact(f)) return true;
  return /od[oó]metro|hor[oó]metro|CONFIRMO|certificado|fecha|hora de la lectura|futura|Unidad:|Funcionamiento|Google Maps|km\)|hs\)|Último reporte|no tiene reporte|detenida|falla de ignición|Decime el número|reporte GPS|🛣|⏱|📋|📍|🔧|📅|🔢|➡️|✅/i.test(
    f,
  );
}

/** Listados y formularios se copian tal cual. Una pregunta (yes_no/status/how_to) nunca se volca. */
export function shouldDumpFactsWithoutLlm(
  facts: string[],
  plan?: TurnPlan,
): boolean {
  const kind = plan?.interpretation?.answerKind;
  if (kind === "yes_no" || kind === "status" || kind === "how_to") return false;
  if (kind === "list") return facts.some(looksLikeListingFact);
  return facts.some(looksLikeListingFact) || facts.some(looksLikeLockedFormFact);
}

export async function redactReply(input: {
  plan: TurnPlan;
  facts: string[];
  state: ConversationStateV3;
  env: NodeJS.ProcessEnv;
  userMessage?: string;
  lastAssistantReply?: string | null;
  conflictClarify?: string | null;
}): Promise<{ reply: string; usedLlm: boolean; latencyMs: number }> {
  if (input.conflictClarify) {
    return { reply: input.conflictClarify, usedLlm: false, latencyMs: 0 };
  }

  if (input.plan.conversationalAct === "greet") {
    const companyFacts = input.facts.filter(
      (f) => /empresa/i.test(f) || /^\d+\.\s/.test(f) || /eleg/i.test(f),
    );
    if (!input.state.company && input.state.availableCompanies.length > 1) {
      const fromFacts = companyFacts.length
        ? companyFacts.join("\n\n")
        : input.state.availableCompanies
            .map((c, i) => `${i + 1}. ${c.name}`)
            .join("\n");
      return {
        reply: formatGreeting({
          introduced: Boolean(input.state.conversationMetadata.introducedAtilio),
          companyListBlock: fromFacts,
        }),
        usedLlm: false,
        latencyMs: 0,
      };
    }
    if (!input.state.company && input.state.availableCompanies.length === 1) {
      return {
        reply: formatGreeting({
          introduced: Boolean(input.state.conversationMetadata.introducedAtilio),
          companyName: input.state.availableCompanies[0]!.name,
        }),
        usedLlm: false,
        latencyMs: 0,
      };
    }
    return {
      reply: formatGreeting({
        introduced: Boolean(input.state.conversationMetadata.introducedAtilio),
        companyName: input.state.company?.name ?? null,
        pendingTaskLabel: input.state.activeTask
          ? labelTask(input.state.activeTask.type)
          : null,
      }),
      usedLlm: false,
      latencyMs: 0,
    };
  }

  // Listados y formularios de escritura: no pasar por LLM (evita resumir/inventar).
  if (shouldDumpFactsWithoutLlm(input.facts, input.plan)) {
    return {
      reply: fallbackFromFacts(input.facts, input.plan),
      usedLlm: false,
      latencyMs: 0,
    };
  }

  // Cancel / switch / farewell: facts del contrato (no inventar menús).
  if (
    input.plan.conversationalAct === "cancel_task" ||
    input.plan.conversationalAct === "switch_task" ||
    input.plan.conversationalAct === "farewell" ||
    input.plan.taskAction === "cancel" ||
    input.plan.taskAction === "switch" ||
    input.plan.responseGoal.purpose === "close"
  ) {
    return {
      reply: fallbackFromFacts(input.facts, input.plan),
      usedLlm: false,
      latencyMs: 0,
    };
  }

  const purpose = input.plan.responseGoal.purpose;
  const questionKind = input.plan.interpretation?.answerKind;
  const wantsNatural =
    purpose === "ask_missing" ||
    purpose === "clarify" ||
    purpose === "resume" ||
    purpose === "confirm_write" ||
    questionKind === "yes_no" ||
    questionKind === "status" ||
    questionKind === "how_to" ||
    Boolean(input.plan.responseGoal.nextQuestion) ||
    Boolean(input.userMessage?.trim());

  if (
    !wantsNatural &&
    input.facts.length === 1 &&
    input.facts[0]!.length < 500
  ) {
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
        temperature: 0.35,
        messages: [
          { role: "system", content: REDACTOR_SYSTEM },
          {
            role: "user",
            content: JSON.stringify({
              userMessage: input.userMessage ?? "",
              lastAssistantReply: input.lastAssistantReply ?? null,
              interpretation: input.plan.interpretation ?? null,
              purpose,
              facts: input.facts,
              nextQuestion: input.plan.responseGoal.nextQuestion ?? null,
              company: input.state.company?.name ?? null,
              unit: input.state.unit?.label ?? null,
              task: input.state.activeTask?.type ?? null,
              act: input.plan.conversationalAct,
              rules:
                "Contestá interpretation.userQuestion (o userMessage) con los facts. Si priorReply.relevant, tené en cuenta lastAssistantReply. Sin saludo. Sin inventar. Primera oración = esa respuesta.",
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
    let text = body.choices?.[0]?.message?.content?.trim() ?? "";
    text = text.replace(/^(hola[^.!?]*[.!?]\s*)+/i, "").trim();
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
    if (facts.some(looksLikeOperationalFact)) return joined;
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
