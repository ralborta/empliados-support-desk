/**
 * Enqueue / process shadow canary — desacoplado de V1.
 * Nunca lanza al caller de enqueue; cero efectos operativos.
 */
import {
  loadShadowCanaryConfig,
  type ShadowCanaryFlags,
} from "./flags.js";
import {
  assertTenantAllowed,
  isPhoneAllowlisted,
  maskPhone,
} from "./allowlist.js";
import { prepareShadowSegment } from "./privacy.js";
import { evaluateShadowSegment } from "./evaluate.js";
import {
  checkDailyCost,
  checkRateLimit,
  createLimitsState,
  type ShadowLimitsState,
} from "./limits.js";
import {
  hasProcessedMessage,
  messageIdHash,
  saveShadowRecord,
  type ShadowRecord,
} from "./store.js";

const limits: ShadowLimitsState = createLimitsState();

export type ShadowCopyInput = {
  phone_e164: string;
  tenant_id: string;
  text: string;
  message_id: string;
  conversation_id?: string;
  has_attachment?: boolean;
  /** Resultado V1 sanitizado (sin PII); opcional, no se usa como golden */
  v1_outcome_sanitized?: Record<string, unknown>;
};

export type ShadowProcessResult = {
  accepted: boolean;
  reason: string;
  record?: ShadowRecord;
  /** Siempre true: el caller V1 no debe esperar */
  async_from_v1: true;
};

function assertNoDelivery(cfg: ShadowCanaryFlags): void {
  if (cfg.DELIVERY_ENABLED !== false) {
    throw new Error("shadow_delivery_not_false");
  }
  if (!cfg.EVALUATION_ONLY) {
    throw new Error("shadow_not_evaluation_only");
  }
}

/**
 * Procesa una copia shadow (síncrono para tests).
 * Idempotente por message_id. Sin reintentos.
 */
export async function processShadowCanaryCopy(
  input: ShadowCopyInput,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ShadowProcessResult> {
  let cfg;
  try {
    cfg = loadShadowCanaryConfig(env);
  } catch (e) {
    return {
      accepted: false,
      reason: e instanceof Error ? e.message : "config_error",
      async_from_v1: true,
    };
  }
  if (!cfg.enabled) {
    return { accepted: false, reason: cfg.reason, async_from_v1: true };
  }
  assertNoDelivery(cfg);

  try {
    assertTenantAllowed(input.tenant_id, cfg.tenant_id);
  } catch {
    return { accepted: false, reason: "tenant_not_allowlisted", async_from_v1: true };
  }

  if (!isPhoneAllowlisted(input.phone_e164, cfg.allowlist_e164)) {
    return { accepted: false, reason: "phone_not_allowlisted", async_from_v1: true };
  }

  if (input.has_attachment) {
    return { accepted: false, reason: "attachments_excluded", async_from_v1: true };
  }

  if (hasProcessedMessage(input.message_id)) {
    return { accepted: false, reason: "duplicate_skipped", async_from_v1: true };
  }

  const rate = checkRateLimit(limits, cfg.rate_per_minute);
  if (!rate.ok) {
    return { accepted: false, reason: rate.reason, async_from_v1: true };
  }

  const cost = checkDailyCost(limits, cfg.daily_cost_usd_max, 0.001);
  if (!cost.ok) {
    return { accepted: false, reason: cost.reason, async_from_v1: true };
  }

  const priv = prepareShadowSegment({
    tenant_id: input.tenant_id,
    conversation_id: input.conversation_id ?? `conv_${input.message_id}`,
    text: input.text,
    has_attachment: input.has_attachment,
  });
  if (!priv.ok) {
    return { accepted: false, reason: priv.reason, async_from_v1: true };
  }

  const evalResult = await evaluateShadowSegment(priv.deid, {
    timeout_ms: cfg.timeout_ms,
  });

  const expires = new Date(Date.now() + cfg.retention_days * 24 * 3600 * 1000);
  const record: ShadowRecord = {
    schema_version: 1,
    message_id: input.message_id,
    message_id_hash: messageIdHash(input.message_id),
    tenant_synth: priv.deid.tenant_id,
    conversation_synth: priv.deid.conversation_id,
    phone_masked: maskPhone(input.phone_e164),
    at: new Date().toISOString(),
    expires_at: expires.toISOString(),
    v1_outcome_sanitized: input.v1_outcome_sanitized,
    v2_proposal: {
      intent: evalResult.intent,
      missing_fields: evalResult.missing_fields,
      clarify: evalResult.clarify,
      hypothetical_transition: evalResult.hypothetical_transition,
      hypothetical_reply: evalResult.hypothetical_reply,
    },
    policy: evalResult.policy,
    latency_ms: evalResult.latency_ms,
    tokens_est: evalResult.tokens_est,
    cost_usd_est: evalResult.cost_usd_est,
    error: evalResult.error,
    effects: evalResult.effects,
    human_expected: null,
  };
  saveShadowRecord(record);
  return { accepted: true, reason: "evaluated", record, async_from_v1: true };
}

/**
 * Fire-and-forget desde V1. Nunca await-eable para el hot path:
 * el caller debe usar `void enqueueShadowCanaryCopy(...)`.
 * Errores / timeouts / kill no afectan a V1.
 */
export function enqueueShadowCanaryCopy(input: ShadowCopyInput): void {
  // Microtask + catch total — no bloquea el event loop del caller de forma sync
  setImmediate(() => {
    void processShadowCanaryCopy(input).catch(() => {
      /* swallow — V1 isolation */
    });
  });
}

/** Demuestra que V1 no espera: marca start y retorna en < boundMs sin await eval. */
export function enqueueAndReturnImmediately(
  input: ShadowCopyInput,
): { enqueued_at: number } {
  const enqueued_at = Date.now();
  enqueueShadowCanaryCopy(input);
  return { enqueued_at };
}
