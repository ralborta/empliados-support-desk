import { FIXED_OPENAI_ENDPOINT } from "../../llm/flags.js";
import { authorizedOpenAiFetch } from "../../llm/network.js";
import { commanderV3ModelName, COMMANDER_V3_PROMPT_VERSION } from "../flags.js";
import {
  COMMANDER_V3_SYSTEM_PROMPT,
  buildCommanderUserPayload,
  buildRepairUserPayload,
} from "./prompt.js";
import type { ConversationStateV3 } from "../types/state.js";
import { TurnPlanSchema, type TurnPlan } from "../types/turn-plan.js";

export type CommanderCallResult = {
  plan: TurnPlan | null;
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

async function chatJson(input: {
  system: string;
  user: string;
  env: NodeJS.ProcessEnv;
  timeoutMs?: number;
}): Promise<{
  raw: unknown;
  model: string;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  error: string | null;
}> {
  const model = commanderV3ModelName(input.env);
  const started = Date.now();
  try {
    const apiKey = requireApiKey(input.env);
    const timeoutMs = input.timeoutMs ?? 25_000;
    const result = await authorizedOpenAiFetch(FIXED_OPENAI_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: input.system },
          { role: "user", content: input.user },
        ],
      }),
      timeoutMs,
    });
    if (result.status < 200 || result.status >= 300) {
      return {
        raw: null,
        model,
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
        raw: content,
        model,
        latencyMs: Date.now() - started,
        inputTokens: body.usage?.prompt_tokens ?? null,
        outputTokens: body.usage?.completion_tokens ?? null,
        error: "json_parse_failed",
      };
    }
    return {
      raw,
      model,
      latencyMs: Date.now() - started,
      inputTokens: body.usage?.prompt_tokens ?? null,
      outputTokens: body.usage?.completion_tokens ?? null,
      error: null,
    };
  } catch (e) {
    return {
      raw: null,
      model,
      latencyMs: Date.now() - started,
      inputTokens: null,
      outputTokens: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

function coercePlan(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const o = { ...(raw as Record<string, unknown>) };

  // task: "certificate.prepare" → certificate
  if (typeof o.task === "string" && o.task.includes(".")) {
    o.task = o.task.split(".")[0];
  }
  if (o.task === "horometer") o.task = "hourmeter";

  // conversationalAct normalize
  const actAliases: Record<string, string> = {
    request: "start_task",
    start: "start_task",
    continue: "continue_task",
    switch: "switch_task",
    amend: "amend_task",
    cancel: "cancel_task",
    confirm: "confirm_write",
    lateral: "answer_lateral",
    query: "inform",
  };
  if (typeof o.conversationalAct === "string") {
    const a = o.conversationalAct.toLowerCase();
    if (actAliases[a]) o.conversationalAct = actAliases[a];
  }
  const allowedActs = new Set([
    "greet",
    "inform",
    "ask",
    "start_task",
    "continue_task",
    "switch_task",
    "amend_task",
    "cancel_task",
    "confirm_write",
    "answer_lateral",
    "farewell",
    "handoff",
  ]);
  if (
    typeof o.conversationalAct !== "string" ||
    !allowedActs.has(o.conversationalAct)
  ) {
    const caps = Array.isArray(o.requestedCapabilities)
      ? (o.requestedCapabilities as Array<{ name?: string }>)
      : [];
    if (caps.some((c) => String(c.name ?? "").includes("prepare"))) {
      o.conversationalAct = "start_task";
    } else if (caps.some((c) => /issue|update|create/.test(String(c.name ?? "")))) {
      o.conversationalAct = "confirm_write";
    } else {
      o.conversationalAct = "inform";
    }
  } else {
    // Act válido pero incoherente con capabilities (ej. greet + certificate.prepare)
    const caps = Array.isArray(o.requestedCapabilities)
      ? (o.requestedCapabilities as Array<{ name?: string }>)
      : [];
    if (
      (o.conversationalAct === "greet" || o.conversationalAct === "inform") &&
      caps.some((c) => String(c.name ?? "").includes("prepare"))
    ) {
      o.conversationalAct = "start_task";
      if (!o.taskAction) o.taskAction = "start";
    }
  }

  const actMap: Record<string, string> = {
    write_prepare: "start",
    prepare: "start",
    write_commit: "confirm",
  };
  if (typeof o.taskAction === "string" && actMap[o.taskAction]) {
    o.taskAction = actMap[o.taskAction];
  }
  if (
    o.taskAction != null &&
    !["start", "continue", "switch", "amend", "cancel", "confirm"].includes(
      String(o.taskAction),
    )
  ) {
    o.taskAction =
      o.conversationalAct === "confirm_write"
        ? "confirm"
        : o.conversationalAct === "cancel_task"
          ? "cancel"
          : "start";
  }

  o.companyReference = coerceEntityRef(o.companyReference, "company");
  o.unitReference = coerceEntityRef(o.unitReference, "unit");

  if (!Array.isArray(o.requestedCapabilities)) o.requestedCapabilities = [];
  if (!o.stateIntent || typeof o.stateIntent !== "object") {
    o.stateIntent = {
      preserveCompany: true,
      preserveUnit: true,
      preserveTask: true,
    };
  }
  if (!o.responseGoal || typeof o.responseGoal !== "object") {
    o.responseGoal = { purpose: "inform", facts: [], nextQuestion: null };
  } else {
    const rg = { ...(o.responseGoal as Record<string, unknown>) };
    if (typeof rg.purpose === "string" && !PURPOSE.has(rg.purpose)) {
      const p = rg.purpose.toLowerCase();
      if (p.includes("confirm")) rg.purpose = "confirm_write";
      else if (p.includes("ask") || p.includes("falt")) rg.purpose = "ask_missing";
      else if (p.includes("clar")) rg.purpose = "clarify";
      else if (p.includes("close") || p.includes("chau")) rg.purpose = "close";
      else if (p.includes("resume") || p.includes("retom")) rg.purpose = "resume";
      else rg.purpose = "inform";
    }
    if (!Array.isArray(rg.facts)) {
      rg.facts =
        typeof rg.purpose === "string" && !PURPOSE.has(String((o.responseGoal as { purpose?: string }).purpose))
          ? [String((o.responseGoal as { purpose?: string }).purpose)]
          : [];
    }
    o.responseGoal = rg;
  }
  if (typeof o.confidence !== "number") o.confidence = 0.5;
  return o;
}

const PURPOSE = new Set([
  "inform",
  "ask_missing",
  "confirm_write",
  "clarify",
  "resume",
  "close",
]);

function coerceEntityRef(v: unknown, kind: "company" | "unit"): unknown {
  if (v == null) return null;
  if (typeof v === "string") {
    const value = v.trim();
    if (!value) return null;
    if (kind === "unit") {
      return {
        kind: "unit",
        mode: /^[A-Za-z]{2}\s*\d/.test(value) ? "plate" : "unit_name",
        value,
        reference: null,
      };
    }
    return { kind: "company", mode: "named", value, reference: null };
  }
  if (typeof v === "object") {
    const r = { ...(v as Record<string, unknown>) };
    if (!r.kind) r.kind = kind;
    if (!r.mode) r.mode = kind === "unit" ? "plate" : "named";
    if (typeof r.value !== "string") r.value = String(r.value ?? "");
    return r;
  }
  return null;
}

export async function callCommander(input: {
  message: string;
  state: ConversationStateV3;
  env: NodeJS.ProcessEnv;
  localNow?: string;
  timezone?: string;
}): Promise<CommanderCallResult> {
  const timezone = input.timezone ?? "America/Argentina/Buenos_Aires";
  const localNow =
    input.localNow ??
    new Date().toLocaleString("sv-SE", { timeZone: timezone }).replace(" ", "T");
  const user = buildCommanderUserPayload({
    message: input.message,
    localNow,
    timezone,
    state: input.state,
  });
  const call = await chatJson({
    system: COMMANDER_V3_SYSTEM_PROMPT,
    user,
    env: input.env,
  });
  if (call.error) {
    return {
      plan: null,
      raw: call.raw,
      model: call.model,
      promptVersion: COMMANDER_V3_PROMPT_VERSION,
      latencyMs: call.latencyMs,
      inputTokens: call.inputTokens,
      outputTokens: call.outputTokens,
      error: call.error,
    };
  }
  const parsed = TurnPlanSchema.safeParse(coercePlan(call.raw));
  return {
    plan: parsed.success ? parsed.data : null,
    raw: call.raw,
    model: call.model,
    promptVersion: COMMANDER_V3_PROMPT_VERSION,
    latencyMs: call.latencyMs,
    inputTokens: call.inputTokens,
    outputTokens: call.outputTokens,
    error: parsed.success ? null : "schema_invalid",
  };
}

export async function repairCommanderPlan(input: {
  originalMessage: string;
  previousPlan: unknown;
  validationErrors: string[];
  state: ConversationStateV3;
  env: NodeJS.ProcessEnv;
}): Promise<CommanderCallResult> {
  const user = buildRepairUserPayload({
    originalMessage: input.originalMessage,
    previousPlan: input.previousPlan,
    validationErrors: input.validationErrors,
    state: input.state,
    allowedCorrections: [
      "fix_schema_fields",
      "drop_invalid_capability",
      "remove_write_commit_without_confirm",
      "align_taskAction_with_act",
      "null_conflicting_refs",
    ],
  });
  const call = await chatJson({
    system: COMMANDER_V3_SYSTEM_PROMPT,
    user,
    env: input.env,
  });
  if (call.error) {
    return {
      plan: null,
      raw: call.raw,
      model: call.model,
      promptVersion: COMMANDER_V3_PROMPT_VERSION,
      latencyMs: call.latencyMs,
      inputTokens: call.inputTokens,
      outputTokens: call.outputTokens,
      error: call.error,
    };
  }
  const parsed = TurnPlanSchema.safeParse(coercePlan(call.raw));
  return {
    plan: parsed.success ? parsed.data : null,
    raw: call.raw,
    model: call.model,
    promptVersion: COMMANDER_V3_PROMPT_VERSION,
    latencyMs: call.latencyMs,
    inputTokens: call.inputTokens,
    outputTokens: call.outputTokens,
    error: parsed.success ? null : "repair_schema_invalid",
  };
}
