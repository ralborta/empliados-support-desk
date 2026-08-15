/**
 * Gateway piloto WhatsApp V2 / Commander V3.
 * BBC entrega el mensaje y envía la respuesta ({message}); V2 no manda WA directo.
 * Modo lab: allowlist. Modo abierto: WARA_V2_PILOT_OPEN=true (todos los números).
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
import {
  CUSTOMER_CLOSE_SUCCESS_MESSAGE,
  looksLikeCustomerConversationCloseRequest,
} from "./customer-conversation-close.js";

const FALLBACK =
  "Disculpá, tuve un problema para procesar eso. ¿Me lo repetís en una línea?";

/** BBC reintenta el mismo texto sin messageId estable → evita spam de replies. */
const recentV3Inbound = new Map<string, number>();
const V3_INBOUND_DEDUPE_MS = 90_000;

function v3InboundDedupeKey(phone: string, text: string): string {
  const p = toE164Guess(phone) || phone.trim();
  return createHash("sha256")
    .update(`${p}|${text.trim().toLowerCase()}`, "utf8")
    .digest("hex");
}

function gcRecentV3Inbound(now: number): void {
  if (recentV3Inbound.size <= 500) return;
  for (const [k, at] of recentV3Inbound) {
    if (now - at > V3_INBOUND_DEDUPE_MS) recentV3Inbound.delete(k);
  }
}

/**
 * Con messageId de WhatsApp, cada mensaje es un turno (el usuario puede repetir
 * el mismo texto si la respuesta anterior fue incorrecta).
 * Sin messageId (reintento BBC): ventana de 90s por teléfono+texto.
 */
export function shouldSkipDuplicateV3Inbound(
  phone: string,
  text: string,
  messageId?: string,
): boolean {
  const now = Date.now();
  gcRecentV3Inbound(now);

  if (messageId?.trim()) {
    const key = `v3mid:${messageId.trim()}`;
    const prev = recentV3Inbound.get(key);
    if (prev != null && now - prev < V3_INBOUND_DEDUPE_MS) return true;
    recentV3Inbound.set(key, now);
    return false;
  }

  const normalized = text.trim().toLowerCase();
  // CONFIRMO/CANCELAR/números sueltos: no deduplicar por texto (reintento mid-trámite).
  if (
    /^(confirmo|confirmó|confirmar|cancelar|cancelo|cancelado|cacelo)$/i.test(
      normalized,
    ) ||
    /^\d+(?:[.,]\d+)?$/.test(normalized)
  ) {
    return false;
  }

  const key = v3InboundDedupeKey(phone, text);
  const prev = recentV3Inbound.get(key);
  if (prev != null && now - prev < V3_INBOUND_DEDUPE_MS) return true;
  recentV3Inbound.set(key, now);
  return false;
}

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

/** Cutover WhatsApp: todos los números (sin allowlist). Kill switch sigue vigente. */
export function isPilotOpen(env: NodeJS.ProcessEnv = process.env): boolean {
  return isTrue(env.WARA_V2_PILOT_OPEN);
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

async function replyResult(
  message: string,
  extra?: Partial<PilotTurnBody>,
): Promise<PilotTurnResult> {
  const body = reply(message, extra);
  // BuilderBot ya publica message.incoming/message.outgoing al webhook del panel.
  // Persistir también desde V3 genera otra fila con IDs v3-in/v3-out distintos
  // del wamid real. El webhook es la única fuente de verdad del hilo visible.
  return { status: 200, body };
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
  // V2 no envía WA propio (BBC lo hace con messageMapping). Delivery ON acá = riesgo de doble envío.
  if (isTrue(env.DELIVERY_ENABLED) || isTrue(env.WARA_V2_DELIVERY_ENABLED)) {
    return false;
  }
  // Lab cerrado: no mezclar con mutaciones/canales reales globales.
  // Modo abierto (PILOT_OPEN): permite writes vía gates específicos + ALLOW_EXTERNAL_MUTATIONS.
  if (!isPilotOpen(env)) {
    if (isTrue(env.ALLOW_EXTERNAL_MUTATIONS)) return false;
    if (isTrue(env.REAL_CHANNELS_ENABLED)) return false;
  }
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

function replyForCustomerClose(text: string, fallback: string): string {
  if (looksLikeCustomerConversationCloseRequest(text)) {
    return CUSTOMER_CLOSE_SUCCESS_MESSAGE;
  }
  return fallback;
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
  if (
    !isPilotOpen(env) &&
    (allowlist.length === 0 || !isAllowlistedPhone(input.phone, allowlist))
  ) {
    return { status: 200, body: silent() };
  }

  const text = input.text.trim();
  const tenant = (env.WARA_V2_SHADOW_TENANT ?? "tenant_internal_ops").trim();
  // Commander V3 — path aislado; V2 brain no interviene.
  if (resolveConductorEnabled(input.phone, env) || isConversationCommanderV3Enabled(env)) {
    if (shouldSkipDuplicateV3Inbound(input.phone, text || "Hola", input.messageId)) {
      return { status: 200, body: silent() };
    }
    const ctx = await loadCommanderV3Context({
      phone: input.phone,
      tenantId: tenant,
      env,
    });
    if (!ctx.ok) {
      return replyResult(ctx.message);
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
        return replyResult(replyForCustomerClose(text, FALLBACK));
      }
      return replyResult(replyForCustomerClose(text, result.reply));
    } catch {
      return replyResult(replyForCustomerClose(text, FALLBACK));
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
    return replyResult(waraResolution.message);
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
    return replyResult(replyForCustomerClose(text, extractReply(decision)));
  } catch {
    return replyResult(replyForCustomerClose(text, FALLBACK));
  }
}
