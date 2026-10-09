/**
 * Activación deliberada Fase 8 — fail-closed.
 * Snapshot oficial reproducible: gpt-4o-mini-2024-07-18
 * Alias gpt-4o-mini = solo experimento (no benchmark oficial).
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
  model: typeof OFFICIAL_MODEL_SNAPSHOT | typeof EXPERIMENTAL_MODEL_ALIAS;
  endpoint: "https://api.openai.com/v1/chat/completions";
  environment: "local" | "ci";
  bindHost: "127.0.0.1" | "localhost";
  databaseUrl: string;
  apiKey: string;
  benchmarkOfficial: boolean;
};

export const ALLOWED_PROVIDER = "openai" as const;
/** Snapshot fijo para benchmarks oficiales / reproducibles. */
export const OFFICIAL_MODEL_SNAPSHOT = "gpt-4o-mini-2024-07-18" as const;
/** Alias no reproducible — solo con WARA_V2_LLM_ALLOW_ALIAS=true (experimento). */
export const EXPERIMENTAL_MODEL_ALIAS = "gpt-4o-mini" as const;
export const ALLOWED_MODEL = OFFICIAL_MODEL_SNAPSHOT;
export const FIXED_OPENAI_ENDPOINT =
  "https://api.openai.com/v1/chat/completions" as const;
export const FIXED_OPENAI_HOSTNAME = "api.openai.com" as const;

function reqExact(env: NodeJS.ProcessEnv, name: string, expected: string): void {
  const v = env[name];
  if (v === undefined || v === "") throw new Error(`flag_missing:${name}`);
  if (expected === "true" && (v === "true" || v === "1")) return;
  if (expected === "false" && (v === "false" || v === "0")) return;
  if (v !== expected) {
    throw new Error(`flag_invalid:${name}=${v};expected=${expected}`);
  }
}

function isDiscardableDb(url: string): boolean {
  if (!url) return false;
  if (/railway|vercel|easypanel|prod|staging|neon\.tech|supabase/i.test(url)) {
    return false;
  }
  return /127\.0\.0\.1|localhost/.test(url);
}

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
  let benchmarkOfficial = true;
  if (model === OFFICIAL_MODEL_SNAPSHOT) {
    benchmarkOfficial = true;
  } else if (
    model === EXPERIMENTAL_MODEL_ALIAS &&
    env.WARA_V2_LLM_ALLOW_ALIAS === "true"
  ) {
    benchmarkOfficial = false;
  } else {
    throw new Error(
      `model_not_allowed:${model || "missing"};official=${OFFICIAL_MODEL_SNAPSHOT}`,
    );
  }
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

  return {
    REAL_MODEL_ENABLED: true,
    SHADOW_MODE: true,
    DELIVERY_ENABLED: false,
    V2_MUTATIONS_DISABLED: true,
    ALLOW_EXTERNAL_MUTATIONS: false,
    REAL_CHANNELS_ENABLED: false,
    SYNTHETIC_DATA_ONLY: true,
    provider: ALLOWED_PROVIDER,
    model: model as Phase8LlmActivation["model"],
    endpoint: FIXED_OPENAI_ENDPOINT,
    environment,
    bindHost,
    databaseUrl,
    apiKey,
    benchmarkOfficial,
  };
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
  process.env.WARA_V2_LLM_MODEL = OFFICIAL_MODEL_SNAPSHOT;
  process.env.WARA_V2_ENV = "local";
  process.env.WARA_V2_BIND_HOST = "127.0.0.1";
  delete process.env.WARA_V2_LLM_ENDPOINT;
  delete process.env.WARA_V2_LLM_ALLOW_ALIAS;
  if (
    !process.env.WARA_V2_DATABASE_URL ||
    /railway|vercel|prod/i.test(process.env.WARA_V2_DATABASE_URL)
  ) {
    process.env.WARA_V2_DATABASE_URL =
      "postgresql://wara_v2:x@127.0.0.1:5433/wara_v2";
  }
  for (const [k, v] of Object.entries(extra)) {
    process.env[k] = v;
  }
}
