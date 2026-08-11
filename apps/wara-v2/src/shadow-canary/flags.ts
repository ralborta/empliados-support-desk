/**
 * Fase 10A — flags shadow canary (fail-closed).
 * Ausencia de flags ⇒ shadow apagado. Nunca combina con delivery.
 */
import { parseExactPhoneAllowlist } from "./allowlist.js";

export const SHADOW_FLAG = "WARA_V2_SHADOW" as const;
export const SHADOW_CANARY_FLAG = "WARA_V2_SHADOW_CANARY" as const;
export const SHADOW_KILL_FLAG = "WARA_V2_SHADOW_KILL" as const;
export const SHADOW_ALLOWLIST_FLAG = "WARA_V2_SHADOW_ALLOWLIST" as const;
export const SHADOW_TENANT_FLAG = "WARA_V2_SHADOW_TENANT" as const;

export type ShadowCanaryFlags = {
  enabled: true;
  WARA_V2_SHADOW: true;
  WARA_V2_SHADOW_CANARY: true;
  EVALUATION_ONLY: true;
  DELIVERY_ENABLED: false;
  ALLOW_EXTERNAL_MUTATIONS: false;
  REAL_CHANNELS_ENABLED: false;
  tenant_id: string;
  allowlist_e164: readonly string[];
  timeout_ms: number;
  daily_cost_usd_max: number;
  rate_per_minute: number;
  retention_days: 30;
};

export type ShadowCanaryDisabled = {
  enabled: false;
  reason: string;
};

export type ShadowCanaryConfig = ShadowCanaryFlags | ShadowCanaryDisabled;

function isTrue(v: string | undefined): boolean {
  return v === "true" || v === "1";
}

/**
 * Carga configuración. Fail-closed: sin flags o mal configurado ⇒ disabled
 * (salvo incompatibilidades hard que lanzan).
 */
export function loadShadowCanaryConfig(
  env: NodeJS.ProcessEnv = process.env,
): ShadowCanaryConfig {
  if (isTrue(env[SHADOW_KILL_FLAG])) {
    return { enabled: false, reason: "kill_switch" };
  }
  if (!isTrue(env[SHADOW_FLAG])) {
    return { enabled: false, reason: "shadow_off" };
  }
  if (!isTrue(env[SHADOW_CANARY_FLAG])) {
    return { enabled: false, reason: "canary_off" };
  }

  if (isTrue(env.DELIVERY_ENABLED)) {
    throw new Error("shadow_incompatible_with_delivery");
  }
  if (isTrue(env.ALLOW_EXTERNAL_MUTATIONS)) {
    throw new Error("shadow_incompatible_with_mutations");
  }
  if (isTrue(env.REAL_CHANNELS_ENABLED)) {
    throw new Error("shadow_incompatible_with_real_channels");
  }
  if (!isTrue(env.EVALUATION_ONLY)) {
    throw new Error("evaluation_only_required_for_shadow_canary");
  }

  const tenant = (env[SHADOW_TENANT_FLAG] ?? "").trim();
  if (!tenant || tenant === "*") {
    throw new Error("shadow_tenant_invalid");
  }

  let allowlist: string[];
  try {
    allowlist = parseExactPhoneAllowlist(env[SHADOW_ALLOWLIST_FLAG] ?? "");
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("allowlist_")) {
      throw e;
    }
    throw e;
  }
  if (allowlist.length === 0) {
    return { enabled: false, reason: "allowlist_empty" };
  }

  const timeout_ms = Number(env.WARA_V2_SHADOW_TIMEOUT_MS ?? "8000");
  const daily_cost_usd_max = Number(env.WARA_V2_SHADOW_DAILY_COST_USD ?? "2");
  const rate_per_minute = Number(env.WARA_V2_SHADOW_RATE_PER_MIN ?? "30");

  return {
    enabled: true,
    WARA_V2_SHADOW: true,
    WARA_V2_SHADOW_CANARY: true,
    EVALUATION_ONLY: true,
    DELIVERY_ENABLED: false,
    ALLOW_EXTERNAL_MUTATIONS: false,
    REAL_CHANNELS_ENABLED: false,
    tenant_id: tenant,
    allowlist_e164: allowlist,
    timeout_ms: Number.isFinite(timeout_ms) ? timeout_ms : 8000,
    daily_cost_usd_max: Number.isFinite(daily_cost_usd_max)
      ? daily_cost_usd_max
      : 2,
    rate_per_minute: Number.isFinite(rate_per_minute) ? rate_per_minute : 30,
    retention_days: 30,
  };
}

/** Helper tests: aplica flags 10A mínimos. */
export function applyShadowCanaryTestFlags(opts: {
  phones: string[];
  tenant?: string;
  kill?: boolean;
}): void {
  process.env[SHADOW_FLAG] = "true";
  process.env[SHADOW_CANARY_FLAG] = "true";
  process.env[SHADOW_KILL_FLAG] = opts.kill ? "true" : "false";
  process.env[SHADOW_ALLOWLIST_FLAG] = opts.phones.join(",");
  process.env[SHADOW_TENANT_FLAG] = opts.tenant ?? "tenant_internal_ops";
  process.env.EVALUATION_ONLY = "true";
  process.env.DELIVERY_ENABLED = "false";
  process.env.ALLOW_EXTERNAL_MUTATIONS = "false";
  process.env.REAL_CHANNELS_ENABLED = "false";
}

export function clearShadowCanaryTestFlags(): void {
  for (const k of [
    SHADOW_FLAG,
    SHADOW_CANARY_FLAG,
    SHADOW_KILL_FLAG,
    SHADOW_ALLOWLIST_FLAG,
    SHADOW_TENANT_FLAG,
    "EVALUATION_ONLY",
    "DELIVERY_ENABLED",
    "ALLOW_EXTERNAL_MUTATIONS",
    "REAL_CHANNELS_ENABLED",
    "WARA_V2_SHADOW_TIMEOUT_MS",
  ]) {
    delete process.env[k];
  }
}
