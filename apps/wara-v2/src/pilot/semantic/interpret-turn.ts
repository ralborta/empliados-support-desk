/**
 * interpretTurn — única autoridad semántica (LLM) cuando el flag está ON.
 */
import { FIXED_OPENAI_ENDPOINT } from "../../llm/flags.js";
import { authorizedOpenAiFetch } from "../../llm/network.js";
import {
  INTERPRET_TURN_PROMPT_VERSION,
  INTERPRET_TURN_SYSTEM_PROMPT,
  buildInterpretTurnUserPayload,
} from "./interpret-turn-prompt.js";
import {
  safeClarifyDecision,
  coerceTurnDecisionRaw,
  TurnDecisionSchema,
  type TurnDecision,
} from "./turn-decision-schema.js";
import { semanticModelName, semanticTimeoutMs } from "./brain-flags.js";

export type InterpretTurnInput = {
  message: string;
  localNow: string;
  timezone: string;
  company?: { id: string; name: string };
  companyContext?: {
    activeCompanyId: string | null;
    activeCompanyName: string | null;
    availableCompanies: Array<{ id: string; name: string }>;
    pendingCompanySelection: boolean;
  };
  selectedUnit?: { id: string; plate?: string; name?: string };
  previousSelectedUnit?: { id: string; plate?: string; name?: string };
  proposedUnit?: { id: string; plate?: string; label?: string };
  activeTramite: string;
  activeStep: string;
  pendingConfirmation?: { action: string; question: string };
  activeDraft?: Record<string, unknown>;
  pendingEntityResolution?: {
    parentIntent: string;
    returnToStep: string;
    searchMode: string | null;
    query: string | null;
  };
  suspendedTramite?: { type: string; step: string };
  lastAgentQuestion?: string;
  lastAgentQuestionMeta?: {
    id: string;
    purpose: string;
    expectedAnswerType: string;
    options?: Array<{ id: string; meaning: string }> | null;
    pendingAction?: string | null;
  };
  expectedAnswerType?: string | null;
  activeListSummary?: { type: string; page: number; visibleIndexes: number[] };
  recentTurns: Array<{ role: "user" | "assistant"; text: string }>;
  availableCapabilities: string[];
  requiredFieldsByCapability: Record<string, string[]>;
};

export type InterpretTurnResult = {
  decision: TurnDecision;
  model: string;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  promptVersion: string;
  repaired: boolean;
  error: string | null;
};

function stripCodeFences(raw: string): string {
  const t = raw.trim();
  if (t.startsWith("```")) {
    return t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  }
  return t;
}

function tryParseDecision(raw: string): { decision: TurnDecision | null; zodError?: string } {
  try {
    const json = coerceTurnDecisionRaw(JSON.parse(stripCodeFences(raw)) as unknown);
    const parsed = TurnDecisionSchema.safeParse(json);
    if (parsed.success) return { decision: parsed.data };
    return {
      decision: null,
      zodError: parsed.error.issues
        .slice(0, 4)
        .map((i) => `${i.path.join(".")}:${i.message}`)
        .join("; "),
    };
  } catch (e) {
    return {
      decision: null,
      zodError: e instanceof Error ? e.message.slice(0, 120) : "json_parse_failed",
    };
  }
}

async function callModel(input: {
  system: string;
  user: string;
  model: string;
  apiKey: string;
  timeoutMs: number;
  repairHint?: string;
}): Promise<{ content: string; inputTokens: number | null; outputTokens: number | null }> {
  const userContent = input.repairHint
    ? `${input.user}\n\nREPAIR: ${input.repairHint}\nDevolvé SOLO JSON TurnDecision válido.`
    : input.user;

  const body = {
    model: input.model,
    temperature: 0.1,
    max_tokens: 500,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: input.system },
      { role: "user", content: userContent },
    ],
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const result = await authorizedOpenAiFetch(FIXED_OPENAI_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${input.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
      timeoutMs: input.timeoutMs,
    });
    if (result.status < 200 || result.status >= 300) {
      throw new Error(`openai_http_${result.status}`);
    }
    const parsed = JSON.parse(result.text) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const content = parsed.choices?.[0]?.message?.content?.trim();
    if (!content) throw new Error("openai_empty_content");
    return {
      content,
      inputTokens: parsed.usage?.prompt_tokens ?? null,
      outputTokens: parsed.usage?.completion_tokens ?? null,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function interpretTurn(
  input: InterpretTurnInput,
  env: NodeJS.ProcessEnv = process.env,
): Promise<InterpretTurnResult> {
  const model = semanticModelName(env);
  const timeoutMs = semanticTimeoutMs(env);
  const apiKey = env.OPENAI_API_KEY?.trim() ?? "";
  const started = Date.now();

  if (!apiKey) {
    return {
      decision: safeClarifyDecision(
        "El intérprete semántico no está disponible ahora. ¿Querés continuar con el trámite actual o cancelar?",
      ),
      model,
      latencyMs: Date.now() - started,
      inputTokens: null,
      outputTokens: null,
      promptVersion: INTERPRET_TURN_PROMPT_VERSION,
      repaired: false,
      error: "missing_api_key",
    };
  }

  const user = buildInterpretTurnUserPayload({
    message: input.message.slice(0, 500),
    localNow: input.localNow,
    timezone: input.timezone,
    company: input.company ?? null,
    companyContext: input.companyContext ?? null,
    selectedUnit: input.selectedUnit ?? null,
    previousSelectedUnit: input.previousSelectedUnit ?? null,
    proposedUnit: input.proposedUnit ?? null,
    activeTramite: input.activeTramite,
    activeStep: input.activeStep,
    pendingConfirmation: input.pendingConfirmation ?? null,
    activeDraft: input.activeDraft ?? null,
    pendingEntityResolution: input.pendingEntityResolution ?? null,
    suspendedTramite: input.suspendedTramite ?? null,
    lastAgentQuestion: input.lastAgentQuestion?.slice(0, 240) ?? null,
    lastAgentQuestionMeta: input.lastAgentQuestionMeta ?? null,
    expectedAnswerType: input.expectedAnswerType ?? null,
    activeListSummary: input.activeListSummary ?? null,
    recentTurns: input.recentTurns.slice(-8).map((t) => ({
      role: t.role,
      text: t.text.slice(0, 280),
    })),
    availableCapabilities: input.availableCapabilities,
    requiredFieldsByCapability: input.requiredFieldsByCapability,
  });

  try {
    const first = await callModel({
      system: INTERPRET_TURN_SYSTEM_PROMPT,
      user,
      model,
      apiKey,
      timeoutMs,
    });
    let firstParse = tryParseDecision(first.content);
    let decision = firstParse.decision;
    let repaired = false;
    let inputTokens = first.inputTokens;
    let outputTokens = first.outputTokens;
    let lastZod = firstParse.zodError;

    if (!decision) {
      repaired = true;
      const second = await callModel({
        system: INTERPRET_TURN_SYSTEM_PROMPT,
        user,
        model,
        apiKey,
        timeoutMs,
        repairHint: `La salida anterior no validó el esquema (${firstParse.zodError ?? "unknown"}). Salida previa: ${first.content.slice(0, 400)}`,
      });
      inputTokens = (inputTokens ?? 0) + (second.inputTokens ?? 0);
      outputTokens = (outputTokens ?? 0) + (second.outputTokens ?? 0);
      const secondParse = tryParseDecision(second.content);
      decision = secondParse.decision;
      lastZod = secondParse.zodError ?? lastZod;
      if (!decision) {
        console.info(
          JSON.stringify({
            event: "wara_v2_interpret_schema_fail",
            zodError: lastZod ?? null,
            rawPreview: second.content.slice(0, 500),
          }),
        );
      }
    }

    if (!decision) {
      return {
        decision: safeClarifyDecision(
          "No pude interpretar bien ese mensaje. ¿Podés decirme la patente o qué trámite querés hacer?",
        ),
        model,
        latencyMs: Date.now() - started,
        inputTokens,
        outputTokens,
        promptVersion: INTERPRET_TURN_PROMPT_VERSION,
        repaired,
        error: lastZod ? `schema_validation_failed:${lastZod.slice(0, 80)}` : "schema_validation_failed",
      };
    }

    // Ambigüedad sin pregunta → forzar clarify seguro (no ejecutar).
    if (decision.action === "clarify" && !decision.ambiguity?.question) {
      decision = safeClarifyDecision();
    }

    return {
      decision,
      model,
      latencyMs: Date.now() - started,
      inputTokens,
      outputTokens,
      promptVersion: INTERPRET_TURN_PROMPT_VERSION,
      repaired,
      error: null,
    };
  } catch (err) {
    const code = err instanceof Error ? err.message : "interpret_turn_failed";
    return {
      decision: safeClarifyDecision(
        "Tuve un problema para interpretar el mensaje. ¿Seguimos con el trámite actual o preferís cancelar?",
      ),
      model,
      latencyMs: Date.now() - started,
      inputTokens: null,
      outputTokens: null,
      promptVersion: INTERPRET_TURN_PROMPT_VERSION,
      repaired: false,
      error: code.slice(0, 80),
    };
  }
}
