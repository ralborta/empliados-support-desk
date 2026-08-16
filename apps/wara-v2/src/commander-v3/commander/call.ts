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
        temperature: 0.28,
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

export function coercePlan(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const o = { ...(raw as Record<string, unknown>) };

  // Capabilities pedidas (normalizar antes de tocar task).
  if (!Array.isArray(o.requestedCapabilities)) o.requestedCapabilities = [];
  const caps = o.requestedCapabilities as Array<{ name?: string; params?: unknown }>;

  // task: "certificate.prepare" → certificate; "company.get_active" → null + cap
  if (typeof o.task === "string") {
    const rawTask = o.task.trim();
    if (rawTask.includes(".")) {
      const [head, ...rest] = rawTask.split(".");
      const capName = rawTask;
      if (head === "company" || head === "domain" || head === "unit") {
        if (!caps.some((c) => c.name === capName)) {
          caps.push({ name: capName, params: {} });
        }
        o.task = head === "unit" ? "unit_query" : null;
        if (head === "unit" && !caps.some((c) => c.name === "unit.search")) {
          caps.push({ name: "unit.search", params: {} });
        }
      } else {
        o.task = head === "horometer" ? "hourmeter" : head;
        if (rest[0] === "prepare" || rest[0] === "get_status") {
          const implied =
            head === "gps"
              ? "gps.get_status"
              : `${head === "horometer" ? "hourmeter" : head}.prepare`;
          if (!caps.some((c) => String(c.name) === implied)) {
            caps.push({ name: implied, params: {} });
          }
        }
      }
    } else if (rawTask === "horometer") {
      o.task = "hourmeter";
    } else if (rawTask === "unit" || rawTask === "fleet" || rawTask === "list") {
      o.task = "unit_query";
    } else if (
      rawTask === "company" ||
      rawTask === "domain"
    ) {
      o.task = null;
    }
  }
  const allowedTasks = new Set([
    "certificate",
    "odometer",
    "hourmeter",
    "maintenance",
    "gps",
    "unit_query",
    "human_handoff",
  ]);
  if (o.task != null && !allowedTasks.has(String(o.task))) {
    o.task = null;
  }

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
    read: "inform",
  };
  if (typeof o.conversationalAct === "string") {
    const a = o.conversationalAct.toLowerCase();
    if (actAliases[a]) o.conversationalAct = actAliases[a];
    // LLM a veces pone el nombre de la capability como acto
    if (
      a === "company.select" ||
      a === "company.list" ||
      a === "company.get_active" ||
      a.startsWith("company.")
    ) {
      o.conversationalAct = "inform";
      const capName =
        a === "company.select" || a.endsWith(".select")
          ? "company.select"
          : a === "company.list" || a.endsWith(".list")
            ? "company.list"
            : "company.get_active";
      if (!caps.some((c) => c.name === capName)) {
        caps.push({ name: capName, params: {} });
      }
    }
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
    if (caps.some((c) => String(c.name ?? "").includes("prepare"))) {
      o.conversationalAct = "start_task";
    } else if (caps.some((c) => /issue|update|create/.test(String(c.name ?? "")))) {
      o.conversationalAct = "confirm_write";
    } else {
      o.conversationalAct = "inform";
    }
  } else {
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
    read: "continue",
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
    // Lecturas / consultas: no forzar "start" (rompe company.get_active).
    const readOnly = caps.every(
      (c) =>
        !String(c.name ?? "").includes("prepare") &&
        !/issue|update|create/.test(String(c.name ?? "")),
    );
    o.taskAction =
      o.conversationalAct === "confirm_write"
        ? "confirm"
        : o.conversationalAct === "cancel_task"
          ? "cancel"
          : readOnly
            ? null
            : "start";
  }

  o.companyReference = coerceEntityRef(o.companyReference, "company");
  o.unitReference = coerceEntityRef(o.unitReference, "unit");

  o.requestedCapabilities = caps;
  // unit.search implica task unit_query
  if (
    caps.some((c) => String(c.name) === "unit.search") &&
    (o.task == null || o.task === "")
  ) {
    o.task = "unit_query";
  }
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
    const originalPurpose =
      typeof rg.purpose === "string" ? rg.purpose : "";
    if (typeof rg.purpose === "string" && !PURPOSE.has(rg.purpose)) {
      const p = rg.purpose.toLowerCase();
      if (p.includes("confirm")) rg.purpose = "confirm_write";
      else if (p.includes("ask") || p.includes("falt")) rg.purpose = "ask_missing";
      else if (p.includes("clar")) rg.purpose = "clarify";
      else if (p.includes("close") || p.includes("chau")) rg.purpose = "close";
      else if (p.includes("resume") || p.includes("retom")) rg.purpose = "resume";
      else rg.purpose = "inform";
    }
    // Selección de empresa no es confirmación de escritura
    if (
      rg.purpose === "confirm_write" &&
      caps.some((c) => String(c.name ?? "").startsWith("company."))
    ) {
      rg.purpose = "inform";
    }
    if (typeof rg.facts === "string") {
      const f = rg.facts.trim();
      rg.facts = f ? [f] : [];
    } else if (!Array.isArray(rg.facts)) {
      rg.facts = originalPurpose && !PURPOSE.has(originalPurpose) ? [originalPurpose] : [];
    }
    if (rg.nextQuestion === undefined) rg.nextQuestion = null;
    o.responseGoal = rg;
  }
  if (typeof o.confidence !== "number" || !Number.isFinite(o.confidence)) {
    o.confidence = 0.5;
  } else {
    o.confidence = Math.min(1, Math.max(0, o.confidence));
  }
  // suppliedFields vacío u objeto raro; value string → number (LLM suele mandar "129556")
  if (o.suppliedFields != null && typeof o.suppliedFields !== "object") {
    o.suppliedFields = null;
  } else if (o.suppliedFields && typeof o.suppliedFields === "object") {
    const sf = { ...(o.suppliedFields as Record<string, unknown>) };
    if (typeof sf.value === "string") {
      const raw = sf.value.trim().replace(",", ".");
      if (/^\d+(?:\.\d+)?$/.test(raw)) {
        const n = Number(raw);
        sf.value = Number.isFinite(n) ? n : null;
      } else {
        sf.value = null;
      }
    }
    o.suppliedFields = sf;
  }
  // reasoning obligatorio para el schema; si falta, sintetizar mínimo
  if (typeof o.reasoning !== "string" || !o.reasoning.trim()) {
    const act = String(o.conversationalAct ?? "inform");
    const task = o.task != null ? String(o.task) : "ninguna";
    o.reasoning = `Acto ${act}; tarea ${task}; capabilities según mensaje y estado.`;
  } else {
    o.reasoning = o.reasoning.trim().slice(0, 800);
  }
  o.interpretation = coerceInterpretation(o);
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

const ANSWER_KINDS = new Set([
  "yes_no",
  "status",
  "how_to",
  "list",
  "start_task",
  "continue_task",
  "clarify",
  "close",
  "greet",
  "other",
]);

const ANSWER_KIND_ALIASES: Record<string, string> = {
  yesno: "yes_no",
  "yes-no": "yes_no",
  boolean: "yes_no",
  gps: "status",
  reporte: "status",
  howto: "how_to",
  "how-to": "how_to",
  guia: "how_to",
  listado: "list",
  fleet: "list",
  start: "start_task",
  continue: "continue_task",
  farewell: "close",
  goodbye: "close",
  greeting: "greet",
};

const PRIOR_REFERS = new Set(["none", "last_facts", "last_question", "active_entity"]);

function answerKindFromAct(act: string): string {
  if (act === "greet") return "greet";
  if (act === "farewell") return "close";
  if (act === "start_task") return "start_task";
  if (act === "continue_task" || act === "amend_task") return "continue_task";
  if (act === "ask") return "clarify";
  return "other";
}

function coerceInterpretation(o: Record<string, unknown>): {
  userQuestion: string;
  answerKind: string;
  priorReply: {
    relevant: boolean;
    summary: string;
    refersTo: string;
  } | null;
} {
  const raw = o.interpretation;
  const act = String(o.conversationalAct ?? "inform");
  let userQuestion = "";
  let answerKind = "";
  let priorReply: {
    relevant: boolean;
    summary: string;
    refersTo: string;
  } | null = null;

  if (raw && typeof raw === "object") {
    const i = raw as Record<string, unknown>;
    if (typeof i.userQuestion === "string") userQuestion = i.userQuestion.trim();
    else if (typeof i.question === "string") userQuestion = i.question.trim();
    const kindRaw = String(i.answerKind ?? i.kind ?? "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "_");
    answerKind = ANSWER_KINDS.has(kindRaw)
      ? kindRaw
      : (ANSWER_KIND_ALIASES[kindRaw] ?? "");
    const pr = i.priorReply ?? i.previousReply;
    if (typeof pr === "string" && pr.trim()) {
      priorReply = {
        relevant: true,
        summary: pr.trim().slice(0, 400),
        refersTo: "last_facts",
      };
    } else if (pr && typeof pr === "object") {
      const p = pr as Record<string, unknown>;
      const refersRaw = String(p.refersTo ?? p.refers_to ?? "none");
      priorReply = {
        relevant: Boolean(p.relevant),
        summary: String(p.summary ?? "").slice(0, 400),
        refersTo: PRIOR_REFERS.has(refersRaw) ? refersRaw : "none",
      };
    }
  }

  if (!userQuestion) {
    const r = String(o.reasoning ?? "").trim();
    const first = r.split(/[.!?]/)[0]?.trim() || r;
    userQuestion = (first || "pedido del turno").slice(0, 400);
  } else {
    userQuestion = userQuestion.slice(0, 400);
  }
  if (!ANSWER_KINDS.has(answerKind)) {
    answerKind = answerKindFromAct(act);
  }
  return { userQuestion, answerKind, priorReply };
}

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
    if (/^\d{1,2}$/.test(value)) {
      return { kind: "company", mode: "index", value, reference: null };
    }
    return { kind: "company", mode: "named", value, reference: null };
  }
  if (typeof v === "object") {
    const r = { ...(v as Record<string, unknown>) };
    if (!r.kind) r.kind = kind;
    // LLM a veces manda {id,name} sin value/mode
    if ((r.id != null || r.companyId != null) && (r.value == null || r.value === "")) {
      r.mode = "id";
      r.value = String(r.id ?? r.companyId);
    } else if (r.name != null && (r.value == null || r.value === "")) {
      r.mode = "named";
      r.value = String(r.name);
    } else if (r.index != null && (r.value == null || r.value === "")) {
      r.mode = "index";
      r.value = String(r.index);
    }
    if (!r.mode) r.mode = kind === "unit" ? "plate" : "named";
    if (typeof r.value !== "string") r.value = String(r.value ?? "");
    if (!String(r.value).trim()) return null;
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
