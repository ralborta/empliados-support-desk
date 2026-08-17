import { FIXED_OPENAI_ENDPOINT } from "../../llm/flags.js";
import { authorizedOpenAiFetch } from "../../llm/network.js";
import {
  runtimeNextModelName,
  RUNTIME_NEXT_PROMPT_VERSION,
} from "../flags.js";
import type { ConversationStateV3 } from "../../commander-v3/types/state.js";
import {
  TurnInterpretationSchema,
  type TurnInterpretation,
} from "../types/interpretation.js";
import { buildInterpreterUserPayload, INTERPRETER_SYSTEM_PROMPT } from "./prompt.js";

export type InterpretCallResult = {
  interpretation: TurnInterpretation | null;
  raw: unknown;
  model: string;
  promptVersion: string;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  error: string | null;
};

function requireApiKey(env: NodeJS.ProcessEnv): string {
  const k = env.OPENAI_API_KEY?.trim() ?? "";
  if (!k || k.length < 20) throw new Error("llm_credential_missing");
  return k;
}

export async function callInterpreter(input: {
  message: string;
  state: ConversationStateV3;
  env: NodeJS.ProcessEnv;
  lastAssistantReply?: string | null;
}): Promise<InterpretCallResult> {
  const model = runtimeNextModelName(input.env);
  const started = Date.now();
  const user = buildInterpreterUserPayload({
    message: input.message,
    state: input.state,
    lastAssistantReply: input.lastAssistantReply,
  });
  try {
    const apiKey = requireApiKey(input.env);
    const result = await authorizedOpenAiFetch(FIXED_OPENAI_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.25,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: INTERPRETER_SYSTEM_PROMPT },
          { role: "user", content: user },
        ],
      }),
      timeoutMs: Number(input.env.WARA_CONVERSATION_RUNTIME_NEXT_TIMEOUT_MS ?? "25000"),
    });
    if (result.status < 200 || result.status >= 300) {
      return {
        interpretation: null,
        raw: null,
        model,
        promptVersion: RUNTIME_NEXT_PROMPT_VERSION,
        latencyMs: Date.now() - started,
        inputTokens: null,
        outputTokens: null,
        error: `http_${result.status}:${result.text.slice(0, 200)}`,
      };
    }
    const body = JSON.parse(result.text) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const content = body.choices?.[0]?.message?.content ?? "";
    let raw: unknown = null;
    try {
      raw = JSON.parse(content);
    } catch {
      return {
        interpretation: null,
        raw: content,
        model,
        promptVersion: RUNTIME_NEXT_PROMPT_VERSION,
        latencyMs: Date.now() - started,
        inputTokens: body.usage?.prompt_tokens ?? null,
        outputTokens: body.usage?.completion_tokens ?? null,
        error: "json_parse_failed",
      };
    }
    const parsed = TurnInterpretationSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        interpretation: null,
        raw,
        model,
        promptVersion: RUNTIME_NEXT_PROMPT_VERSION,
        latencyMs: Date.now() - started,
        inputTokens: body.usage?.prompt_tokens ?? null,
        outputTokens: body.usage?.completion_tokens ?? null,
        error: `schema_invalid:${parsed.error.message.slice(0, 120)}`,
      };
    }
    return {
      interpretation: parsed.data,
      raw,
      model,
      promptVersion: RUNTIME_NEXT_PROMPT_VERSION,
      latencyMs: Date.now() - started,
      inputTokens: body.usage?.prompt_tokens ?? null,
      outputTokens: body.usage?.completion_tokens ?? null,
      error: null,
    };
  } catch (e) {
    return {
      interpretation: null,
      raw: null,
      model,
      promptVersion: RUNTIME_NEXT_PROMPT_VERSION,
      latencyMs: Date.now() - started,
      inputTokens: null,
      outputTokens: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
