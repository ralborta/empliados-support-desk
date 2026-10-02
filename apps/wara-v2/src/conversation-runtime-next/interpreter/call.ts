import { FIXED_OPENAI_ENDPOINT } from "../../llm/flags.js";
import { authorizedOpenAiFetch } from "../../llm/network.js";
import {
  runtimeNextModelName,
  RUNTIME_NEXT_PROMPT_VERSION,
} from "../flags.js";
import type { ConversationStateV3 } from "../../commander-v3/types/state.js";
import type { TurnInterpretation } from "../types/interpretation.js";
import { SERVICE_REGISTRY } from "../registry/service-registry.js";
import {
  buildInterpreterUserPayload,
  INTERPRETER_SYSTEM_PROMPT,
} from "./prompt.js";
import { parseInterpretation } from "./coerce.js";
import {
  classifyErrorCode,
  classifyHttpFailure,
  classifyThrownError,
  sanitizeForTrace,
  sanitizeRawOutput,
  type InterpreterAttemptDiagnostic,
  type InterpreterDiagnostic,
  type InterpreterFailureKind,
} from "./diagnostics.js";

export type InterpretCallResult = {
  interpretation: TurnInterpretation | null;
  raw: unknown;
  model: string;
  promptVersion: string;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  error: string | null;
  failureKind: InterpreterFailureKind | null;
  diagnostic: InterpreterDiagnostic;
};

type OpenAiCallResult = {
  attemptDiag: InterpreterAttemptDiagnostic;
  usage: { inputTokens: number | null; outputTokens: number | null };
  interpretation: TurnInterpretation | null;
  raw: unknown;
};

function requireApiKey(env: NodeJS.ProcessEnv): string {
  const k = env.OPENAI_API_KEY?.trim() ?? "";
  if (!k || k.length < 20) throw new Error("llm_credential_missing");
  return k;
}

function timeoutMs(env: NodeJS.ProcessEnv): number {
  const n = Number(env.WARA_CONVERSATION_RUNTIME_NEXT_TIMEOUT_MS ?? "25000");
  return Number.isFinite(n) && n > 0 ? Math.min(n, 60000) : 25000;
}

function buildRepairUserPayload(
  originalUser: string,
  invalidRaw: unknown,
  schemaErrors: string[],
): string {
  return JSON.stringify({
    repair: true,
    schemaErrors,
    previousOutput: sanitizeRawOutput(invalidRaw, 600),
    originalUserPayload: JSON.parse(originalUser),
    instruction:
      "Devuelve SOLO JSON válido que cumpla el schema TurnInterpretation. entities debe ser objeto {} (no array). operationHint solo conversation|read|write|handoff u omitir. Corrige campos inválidos; no inventes patentes ni datos.",
  });
}

async function openAiJsonCall(input: {
  env: NodeJS.ProcessEnv;
  model: string;
  system: string;
  user: string;
  attempt: number;
  kind: InterpreterAttemptDiagnostic["kind"];
}): Promise<OpenAiCallResult> {
  const attemptStart = Date.now();
  const attemptStartedAt = new Date(attemptStart).toISOString();
  const emptyUsage = { inputTokens: null, outputTokens: null };

  try {
    const apiKey = requireApiKey(input.env);
    const result = await authorizedOpenAiFetch(FIXED_OPENAI_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: input.model,
        temperature: 0.25,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: input.system },
          { role: "user", content: input.user },
        ],
      }),
      timeoutMs: timeoutMs(input.env),
    });

    if (result.status < 200 || result.status >= 300) {
      const failureKind = classifyHttpFailure(result.status, result.text);
      return {
        attemptDiag: {
          attempt: input.attempt,
          kind: input.kind,
          startedAt: attemptStartedAt,
          finishedAt: new Date().toISOString(),
          latencyMs: Date.now() - attemptStart,
          httpStatus: result.status,
          failureKind,
          safeErrorMessage: sanitizeForTrace(
            `http_${result.status}:${result.text.slice(0, 200)}`,
          ),
          timedOut: false,
        },
        usage: emptyUsage,
        interpretation: null,
        raw: null,
      };
    }

    const body = JSON.parse(result.text) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const content = body.choices?.[0]?.message?.content ?? "";
    const usage = {
      inputTokens: body.usage?.prompt_tokens ?? null,
      outputTokens: body.usage?.completion_tokens ?? null,
    };

    if (!content.trim()) {
      return {
        attemptDiag: {
          attempt: input.attempt,
          kind: input.kind,
          startedAt: attemptStartedAt,
          finishedAt: new Date().toISOString(),
          latencyMs: Date.now() - attemptStart,
          httpStatus: result.status,
          failureKind: "empty_response",
          safeErrorMessage: "empty_response",
          timedOut: false,
        },
        usage,
        interpretation: null,
        raw: null,
      };
    }

    let raw: unknown;
    try {
      raw = JSON.parse(content);
    } catch {
      return {
        attemptDiag: {
          attempt: input.attempt,
          kind: input.kind,
          startedAt: attemptStartedAt,
          finishedAt: new Date().toISOString(),
          latencyMs: Date.now() - attemptStart,
          httpStatus: result.status,
          failureKind: "invalid_json",
          safeErrorMessage: "json_parse_failed",
          timedOut: false,
          rawSanitized: sanitizeForTrace(content, 400),
        },
        usage,
        interpretation: null,
        raw: content,
      };
    }

    const parsed = parseInterpretation(raw);
    if (!parsed.ok) {
      return {
        attemptDiag: {
          attempt: input.attempt,
          kind: input.kind,
          startedAt: attemptStartedAt,
          finishedAt: new Date().toISOString(),
          latencyMs: Date.now() - attemptStart,
          httpStatus: result.status,
          failureKind: "schema_validation_failed",
          safeErrorMessage: sanitizeForTrace(
            `schema_invalid:${parsed.schemaErrors.slice(0, 3).join("; ")}`,
          ),
          timedOut: false,
          rawSanitized: sanitizeRawOutput(parsed.coerced),
          schemaErrors: parsed.schemaErrors,
        },
        usage,
        interpretation: null,
        raw: parsed.coerced,
      };
    }

    return {
      attemptDiag: {
        attempt: input.attempt,
        kind: input.kind,
        startedAt: attemptStartedAt,
        finishedAt: new Date().toISOString(),
        latencyMs: Date.now() - attemptStart,
        httpStatus: result.status,
        timedOut: false,
      },
      usage,
      interpretation: parsed.data,
      raw: parsed.data,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      attemptDiag: {
        attempt: input.attempt,
        kind: input.kind,
        startedAt: attemptStartedAt,
        finishedAt: new Date().toISOString(),
        latencyMs: Date.now() - attemptStart,
        failureKind: classifyThrownError(msg),
        safeErrorMessage: sanitizeForTrace(msg),
        timedOut: msg === "llm_timeout",
      },
      usage: emptyUsage,
      interpretation: null,
      raw: null,
    };
  }
}

export async function callInterpreter(input: {
  message: string;
  state: ConversationStateV3;
  env: NodeJS.ProcessEnv;
  lastAssistantReply?: string | null;
}): Promise<InterpretCallResult> {
  const model = runtimeNextModelName(input.env);
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  const user = buildInterpreterUserPayload({
    message: input.message,
    state: input.state,
    lastAssistantReply: input.lastAssistantReply,
  });
  const attempts: InterpreterAttemptDiagnostic[] = [];

  const primary = await openAiJsonCall({
    env: input.env,
    model,
    system: INTERPRETER_SYSTEM_PROMPT,
    user,
    attempt: 1,
    kind: "primary",
  });
  attempts.push(primary.attemptDiag);

  let interpretation = primary.interpretation;
  let finalRaw = primary.raw;
  let inputTokens = primary.usage.inputTokens;
  let outputTokens = primary.usage.outputTokens;
  let finalFailureKind: InterpreterFailureKind | null = null;
  let error: string | null = null;

  if (
    !interpretation &&
    (primary.attemptDiag.failureKind === "invalid_json" ||
      primary.attemptDiag.failureKind === "schema_validation_failed")
  ) {
    const repairUser = buildRepairUserPayload(
      user,
      primary.raw ?? primary.attemptDiag.rawSanitized ?? {},
      primary.attemptDiag.schemaErrors ?? ["schema_invalid"],
    );
    const repair = await openAiJsonCall({
      env: input.env,
      model,
      system: INTERPRETER_SYSTEM_PROMPT,
      user: repairUser,
      attempt: 2,
      kind: "repair",
    });
    attempts.push(repair.attemptDiag);
    if (repair.usage.inputTokens != null) inputTokens = repair.usage.inputTokens;
    if (repair.usage.outputTokens != null) outputTokens = repair.usage.outputTokens;

    if (repair.interpretation) {
      interpretation = repair.interpretation;
      finalRaw = repair.raw;
    } else {
      finalFailureKind =
        repair.attemptDiag.failureKind ??
        primary.attemptDiag.failureKind ??
        "unknown_error";
      error =
        repair.attemptDiag.safeErrorMessage ??
        primary.attemptDiag.safeErrorMessage ??
        finalFailureKind;
      finalRaw = repair.raw ?? primary.raw;
    }
  } else if (!interpretation) {
    finalFailureKind = primary.attemptDiag.failureKind ?? "unknown_error";
    error = primary.attemptDiag.safeErrorMessage ?? finalFailureKind;
  }

  if (!interpretation && error) {
    finalFailureKind = finalFailureKind ?? classifyErrorCode(error);
  }

  const diagnostic: InterpreterDiagnostic = {
    model,
    promptVersion: RUNTIME_NEXT_PROMPT_VERSION,
    systemPromptChars: INTERPRETER_SYSTEM_PROMPT.length,
    userPayloadChars: user.length,
    serviceRegistryCount: SERVICE_REGISTRY.length,
    startedAt,
    finishedAt: new Date().toISOString(),
    latencyMs: Date.now() - started,
    attempts,
    finalFailureKind: interpretation ? null : finalFailureKind,
    fallbackReason: interpretation ? null : finalFailureKind ?? "unknown_error",
    inputTokens,
    outputTokens,
  };

  return {
    interpretation,
    raw: finalRaw,
    model,
    promptVersion: RUNTIME_NEXT_PROMPT_VERSION,
    latencyMs: diagnostic.latencyMs,
    inputTokens,
    outputTokens,
    error: interpretation ? null : error ?? finalFailureKind ?? "unknown_error",
    failureKind: interpretation ? null : finalFailureKind,
    diagnostic,
  };
}

/** Llamada mínima de conectividad (sin catálogo ni historial). */
export async function callInterpreterMinimal(input: {
  message: string;
  env: NodeJS.ProcessEnv;
}): Promise<OpenAiCallResult & { model: string }> {
  const model = runtimeNextModelName(input.env);
  const minimalSystem = `Devuelve JSON con: userAct, relation, normalizedMeaning, requests[], references[], corrections[], answersExpectedField, confidence. Sin inventar datos.`;
  const minimalUser = JSON.stringify({ message: input.message });
  const r = await openAiJsonCall({
    env: input.env,
    model,
    system: minimalSystem,
    user: minimalUser,
    attempt: 1,
    kind: "primary",
  });
  return { ...r, model };
}
