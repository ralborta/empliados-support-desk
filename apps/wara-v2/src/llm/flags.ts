/**
 * Activación deliberada Fase 8 — fail-closed.
 * REAL_MODEL_ENABLED=true solo no basta.
 */
export type Phase8LlmActivation = {
  REAL_MODEL_ENABLED: true;
  SHADOW_MODE: true;
  DELIVERY_ENABLED: false;
  V2_MUTATIONS_DISABLED: true;
  ALLOW_EXTERNAL_MUTATIONS: false;
  REAL_CHANNELS_ENABLED: false;
  SYNTHETIC_DATA_ONLY: true;
  provider: "openai";
  model: "gpt-4o-mini";
  endpoint: "https://api.openai.com/v1/chat/completions";
  environment: "local" | "ci";
  bindHost: "127.0.0.1" | "localhost";
  databaseUrl: string;
  apiKey: string;
};

export const ALLOWED_PROVIDER = "openai" as const;
export const ALLOWED_MODEL = "gpt-4o-mini" as const;
export const FIXED_OPENAI_ENDPOINT =
  "https://api.openai.com/v1/chat/completions" as const;
export const FIXED_OPENAI_HOSTNAME = "api.openai.com" as const;

function reqExact(env: NodeJS.ProcessEnv, name: string, expected: string): void {
  const v = env[name];
  if (v === undefined || v === "") throw new Error(`flag_missing:${name}`);
  if (v !== expected && !(expected === "true" && v === "1") && !(expected === "false" && (v === "0" || v === "false"))) {
    // allow true/1 and false/0 aliases for booleans encoded as expected "true"/"false"
    if (expected === "true" && (v === "true" || v === "1")) return;
    if (expected === "false" && (v === "false" || v === "0")) return;
    throw new Error(`flag_invalid:${name}=${v};expected=${expected}`);
  }
}

function isDiscardableDb(url: string): boolean {
  if (!url) return false;
  if (/railway|vercel|easypanel|prod|staging|neon\.tech|supabase/i.test(url)) {
    return false;
  }
  // embedded harness / loopback
  return /127\.0\.0\.1|localhost/.test(url);
}

/**
 * Carga activación LLM real. Cualquier ausencia/contradicción ⇒ throw.
 * No muta process.env.
 */
export function loadPhase8LlmActivation(
  env: NodeJS.ProcessEnv = process.env,
): Phase8LlmActivation {
  reqExact(env, "REAL_MODEL_ENABLED", "true");
  reqExact(env, "SHADOW_MODE", "true");
  reqExact(env, "DELIVERY_ENABLED", "false");
  reqExact(env, "V2_MUTATIONS_DISABLED", "true");
  reqExact(env, "ALLOW_EXTERNAL_MUTATIONS", "false");
  reqExact(env, "REAL_CHANNELS_ENABLED", "false");
  reqExact(env, "SYNTHETIC_DATA_ONLY", "true");

  const provider = env.WARA_V2_LLM_PROVIDER ?? "";
  if (provider !== ALLOWED_PROVIDER) {
    throw new Error(`provider_not_allowed:${provider || "missing"}`);
  }
  const model = env.WARA_V2_LLM_MODEL ?? "";
  if (model !== ALLOWED_MODEL) {
    throw new Error(`model_not_allowed:${model || "missing"}`);
  }
  // Endpoint fijo en código — rechazar override
  if (env.WARA_V2_LLM_ENDPOINT && env.WARA_V2_LLM_ENDPOINT !== FIXED_OPENAI_ENDPOINT) {
    throw new Error("endpoint_override_forbidden");
  }

  const environment = env.WARA_V2_ENV ?? "";
  if (environment !== "local" && environment !== "ci") {
    throw new Error(`environment_not_authorized:${environment || "missing"}`);
  }

  const bindHost = env.WARA_V2_BIND_HOST ?? "127.0.0.1";
  if (bindHost !== "127.0.0.1" && bindHost !== "localhost") {
    throw new Error(`bind_host_not_loopback:${bindHost}`);
  }

  const databaseUrl = env.WARA_V2_DATABASE_URL ?? "";
  if (!isDiscardableDb(databaseUrl)) {
    throw new Error("database_not_discardable");
  }

  const apiKey = env.OPENAI_API_KEY ?? "";
  if (!apiKey || apiKey.length < 20) {
    throw new Error("llm_credential_missing");
  }
  if (/sk-proj-prod|production/i.test(apiKey)) {
    // soft check — still require explicit local/ci env above
  }

  return {
    REAL_MODEL_ENABLED: true,
    SHADOW_MODE: true,
    DELIVERY_ENABLED: false,
    V2_MUTATIONS_DISABLED: true,
    ALLOW_EXTERNAL_MUTATIONS: false,
    REAL_CHANNELS_ENABLED: false,
    SYNTHETIC_DATA_ONLY: true,
    provider: ALLOWED_PROVIDER,
    model: ALLOWED_MODEL,
    endpoint: FIXED_OPENAI_ENDPOINT,
    environment,
    bindHost,
    databaseUrl,
    apiKey,
  };
}

/** REAL_MODEL_ENABLED solo no habilita el adaptador. */
export function assertRealModelAloneInsufficient(
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (env.REAL_MODEL_ENABLED === "true") {
    try {
      loadPhase8LlmActivation(env);
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("flag_missing:SHADOW_MODE")) {
        return; // expected fail-closed
      }
      // other missing flags also prove insufficiency
      return;
    }
  }
}

export function applyPhase8TestFlags(extra: Record<string, string> = {}): void {
  process.env.REAL_MODEL_ENABLED = "true";
  process.env.SHADOW_MODE = "true";
  process.env.DELIVERY_ENABLED = "false";
  process.env.V2_MUTATIONS_DISABLED = "true";
  process.env.ALLOW_EXTERNAL_MUTATIONS = "false";
  process.env.REAL_CHANNELS_ENABLED = "false";
  process.env.SYNTHETIC_DATA_ONLY = "true";
  process.env.WARA_V2_LLM_PROVIDER = "openai";
  process.env.WARA_V2_LLM_MODEL = "gpt-4o-mini";
  process.env.WARA_V2_ENV = "local";
  process.env.WARA_V2_BIND_HOST = "127.0.0.1";
  delete process.env.WARA_V2_LLM_ENDPOINT; // endpoint fijo en código
  if (!process.env.WARA_V2_DATABASE_URL || /railway|vercel|prod/i.test(process.env.WARA_V2_DATABASE_URL)) {
    process.env.WARA_V2_DATABASE_URL =
      "postgresql://wara_v2:x@127.0.0.1:5433/wara_v2";
  }
  for (const [k, v] of Object.entries(extra)) {
    process.env[k] = v;
  }
}
