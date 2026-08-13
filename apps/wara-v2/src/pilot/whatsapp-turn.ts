/**
 * Gateway piloto WhatsApp V2.
 * BBC entrega el mensaje ({message}); V2 no envía WhatsApp (DELIVERY_ENABLED=false).
 * Solo allowlist. WARA/Odoo read-only; sin mutaciones.
 */
import { randomUUID, createHash } from "node:crypto";
import type { OrchestratorDecision } from "@wara-v2/contracts";
import type { ModelAdapter, TurnContext } from "@wara-v2/orchestrator";
import { DEFAULT_FEATURE_FLAGS } from "@wara-v2/orchestrator";
import {
  OFFICIAL_MODEL_SNAPSHOT,
  FIXED_OPENAI_ENDPOINT,
  type Phase8LlmActivation,
} from "../llm/flags.js";
import { OpenAiChatAdapter } from "../llm/openai-adapter.js";
import { TokenBudget } from "../llm/circuit.js";
import { parseExactPhoneAllowlist } from "../shadow-canary/allowlist.js";
import { isAllowlistedPhone, toE164Guess } from "./phone.js";
import { buildPilotMessages } from "./prompt.js";
import { resolvePilotWaraTurn } from "./wara-context.js";
import type { WaraPromptSnapshot } from "./wara-types.js";
import {
  isConversationCommanderV3Enabled,
  runCommanderTurn,
} from "../commander-v3/index.js";
import { loadCommanderV3Context } from "../commander-v3/lab/load-context.js";
import { saveConversationStateV3 } from "../commander-v3/persistence/store.js";
import { resolveConductorEnabled } from "../commander-v3/lab/conductor-mode.js";

const FALLBACK =
  "Disculpá, tuve un problema para procesar eso. ¿Me lo repetís en una línea?";

export type PilotTurnBody = {
  ok: boolean;
  ok_s: string;
  message: string;
  skipResponse_s: string;
  flowComplete_s: string;
  nextFlow: string;
  nextFlow_s: string;
  engine: "wara-v2";
  error?: string;
};

export type PilotTurnResult = {
  status: number;
  body: PilotTurnBody;
};

export type PilotDecide = (ctx: TurnContext) => Promise<unknown>;

function isTrue(v: string | undefined): boolean {
  return v === "true" || v === "1";
}

function silent(extra?: Partial<PilotTurnBody>): PilotTurnBody {
  return {
    ok: true,
    ok_s: "true",
    message: "",
    skipResponse_s: "true",
    flowComplete_s: "true",
    nextFlow: "ignore",
    nextFlow_s: "ignore",
    engine: "wara-v2",
    ...extra,
  };
}

function reply(message: string, extra?: Partial<PilotTurnBody>): PilotTurnBody {
  return {
    ok: true,
    ok_s: "true",
    message,
    skipResponse_s: "false",
    flowComplete_s: "true",
    nextFlow: "",
    nextFlow_s: "",
    engine: "wara-v2",
    ...extra,
  };
}

export function loadPilotAllowlist(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  try {
    return parseExactPhoneAllowlist(env.WARA_V2_SHADOW_ALLOWLIST ?? "");
  } catch {
    return [];
  }
}

export function isPilotWhatsAppEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (isTrue(env.WARA_V2_PILOT_KILL) || isTrue(env.WARA_V2_SHADOW_KILL)) {
    return false;
  }
  if (!isTrue(env.WARA_V2_PILOT_WHATSAPP)) return false;
  if (isTrue(env.DELIVERY_ENABLED)) return false;
  if (isTrue(env.ALLOW_EXTERNAL_MUTATIONS)) return false;
  if (isTrue(env.REAL_CHANNELS_ENABLED)) return false;
  return true;
}

function expectedApiKey(env: NodeJS.ProcessEnv): string {
  return (
    env.WARA_V2_TURN_API_KEY?.trim() ||
    env.BUILDERBOT_CONTEXT_API_KEY?.trim() ||
    ""
  );
}

function looksLikeInternalFieldToken(s: string): boolean {
  return /^[a-z][a-z0-9_]*$/i.test(s) && s.includes("_");
}

function extractReply(decision: unknown): string {
  if (!decision || typeof decision !== "object") return FALLBACK;
  const d = decision as OrchestratorDecision;
  const summary = String(d.interpretationSummary ?? "").trim();
  if (summary && !looksLikeInternalFieldToken(summary)) return summary;
  const mustAsk = d.responseHints?.mustAsk?.[0]?.trim();
  if (mustAsk && !looksLikeInternalFieldToken(mustAsk)) return mustAsk;
  return FALLBACK;
}

export function buildPilotTurnContext(input: {
  phone: string;
  text: string;
  tenantId: string;
  wara?: WaraPromptSnapshot;
  companyName?: string | null;
}): TurnContext {
  const phone = toE164Guess(input.phone) || "+00000000000";
  const text = input.text.slice(0, 2000);
  const payloadHash = createHash("sha256").update(text, "utf8").digest("hex");
  const companyId = input.companyName ?? input.wara?.company_name ?? input.tenantId;
  return {
    conversation: {
      conversationId: `pilot_${digitsSafe(phone)}`,
      customerId: `pilot_c_${digitsSafe(phone)}`,
      activeCompanyId: companyId,
      activeUnitId: null,
      channel: "whatsapp_pilot",
      channelAccountId: "bbc-pilot",
      membershipCompanyIds: input.wara?.contacts_count
        ? Array.from({ length: input.wara.contacts_count }, (_, i) => String(i + 1))
        : [input.tenantId],
    },
    inbound: {
      messageId: randomUUID(),
      provider: "builderbot",
      channelAccountId: "bbc-pilot",
      conversationKey: phone,
      channel: "whatsapp_pilot",
      customerPhoneE164: phone,
      text,
      receivedAt: new Date().toISOString(),
      payloadHash,
    },
    activeOperations: [],
    pendingConfirmationOperationId: null,
    stateVersion: 0,
    executionMode: "pilot",
    featureFlags: {
      ...DEFAULT_FEATURE_FLAGS,
      allowWhatsAppSend: false,
      allowWaraMutations: false,
      allowOdooMutations: false,
    },
    now: new Date(),
  };
}

function digitsSafe(phone: string): string {
  return phone.replace(/\D/g, "").slice(-12) || "unknown";
}

export function createPilotActivation(
  env: NodeJS.ProcessEnv = process.env,
): Phase8LlmActivation {
  const apiKey = env.OPENAI_API_KEY ?? "";
  if (!apiKey || apiKey.length < 20) {
    throw new Error("llm_credential_missing");
  }
  return {
    REAL_MODEL_ENABLED: true,
    SHADOW_MODE: true,
    DELIVERY_ENABLED: false,
    V2_MUTATIONS_DISABLED: true,
    ALLOW_EXTERNAL_MUTATIONS: false,
    REAL_CHANNELS_ENABLED: false,
    SYNTHETIC_DATA_ONLY: true,
    provider: "openai",
    model: OFFICIAL_MODEL_SNAPSHOT,
    endpoint: FIXED_OPENAI_ENDPOINT,
    environment: "local",
    bindHost: "127.0.0.1",
    databaseUrl: "postgresql://wara_v2:x@127.0.0.1:5433/wara_v2",
    apiKey,
    benchmarkOfficial: true,
  };
}

export function createPilotModelAdapter(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl?: typeof fetch,
  waraSnapshot?: WaraPromptSnapshot,
): ModelAdapter {
  return new OpenAiChatAdapter({
    activation: createPilotActivation(env),
    fetchImpl,
    timeoutMs: Number(env.WARA_V2_PILOT_TIMEOUT_MS ?? "20000"),
    budget: new TokenBudget(500_000, 5),
    buildMessages: (ctx) => buildPilotMessages(ctx, waraSnapshot),
  });
}

export async function handlePilotWhatsAppTurn(input: {
  phone: string;
  text: string;
  messageId: string;
  apiKey?: string;
  env?: NodeJS.ProcessEnv;
  decide?: PilotDecide;
}): Promise<PilotTurnResult> {
  const env = input.env ?? process.env;
  if (!isPilotWhatsAppEnabled(env)) {
    return {
      status: 503,
      body: silent({
        ok: false,
        ok_s: "false",
        error: "pilot_disabled",
      }),
    };
  }

  const expected = expectedApiKey(env);
  if (!expected || !input.apiKey || input.apiKey !== expected) {
    return {
      status: 401,
      body: silent({ ok: false, ok_s: "false", error: "unauthorized" }),
    };
  }

  const allowlist = loadPilotAllowlist(env);
  if (allowlist.length === 0 || !isAllowlistedPhone(input.phone, allowlist)) {
    return { status: 200, body: silent() };
  }

  const text = input.text.trim();
  const tenant = (env.WARA_V2_SHADOW_TENANT ?? "tenant_internal_ops").trim();

  // Commander V3 — path aislado; V2 brain no interviene.
  if (resolveConductorEnabled(input.phone, env) || isConversationCommanderV3Enabled(env)) {
    const ctx = await loadCommanderV3Context({
      phone: input.phone,
      tenantId: tenant,
      env,
    });
    if (!ctx.ok) {
      return { status: 200, body: reply(ctx.message) };
    }
    saveConversationStateV3(ctx.state);
    try {
      const result = await runCommanderTurn({
        tenantId: tenant,
        phone: input.phone,
        message: text || "Hola",
        messageId: input.messageId,
        env,
        contacts: ctx.contacts,
        fleetUnits: ctx.fleetUnits,
        customerName: ctx.customerName,
      });
      if (!result.reply.trim()) {
        return { status: 200, body: silent({ skipResponse_s: "true" }) };
      }
      return { status: 200, body: reply(result.reply) };
    } catch {
      return { status: 200, body: reply(FALLBACK) };
    }
  }

  const waraResolution = await resolvePilotWaraTurn({
    phone: input.phone,
    text: text || "Hola",
    messageId: input.messageId,
    env,
  });

  if (waraResolution.kind === "reply") {
    if (!waraResolution.message.trim()) {
      return { status: 200, body: silent({ skipResponse_s: "true" }) };
    }
    return { status: 200, body: reply(waraResolution.message) };
  }

  const ctx = buildPilotTurnContext({
    phone: input.phone,
    text: text || "Hola",
    tenantId: tenant,
    wara: waraResolution.snapshot,
    companyName: waraResolution.session.companyName,
  });

  try {
    const decide =
      input.decide ??
      ((c: TurnContext) =>
        createPilotModelAdapter(env, undefined, waraResolution.snapshot).decide(c));
    const decision = await decide(ctx);
    return { status: 200, body: reply(extractReply(decision)) };
  } catch {
    return { status: 200, body: reply(FALLBACK) };
  }
}
