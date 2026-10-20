/**
 * Router estable V1/V2 — implementado pero apagado por defecto.
 * V1 permanece ruta predeterminada; V2 solo allowlist explícita.
 */
import { parseExactPhoneAllowlist, isPhoneAllowlisted } from "../shadow-canary/allowlist.js";

export type RouterDecision =
  | { route: "v1"; reason: string }
  | { route: "v2"; reason: string }
  | { route: "blocked"; reason: string };

export type VersionRouterInput = {
  phoneE164: string;
  tenantId: string;
  capability?: string;
  messageId: string;
  env?: NodeJS.ProcessEnv;
};

function isTrue(v: string | undefined): boolean {
  return (v ?? "").trim().toLowerCase() === "true" || v === "1";
}

export function isVersionRouterEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return isTrue(env.WARA_V2_ROUTER_ENABLED);
}

export function isVersionRouterKillSwitch(env: NodeJS.ProcessEnv = process.env): boolean {
  return isTrue(env.WARA_V2_ROUTER_KILL) || isTrue(env.WARA_V2_SHADOW_KILL) || isTrue(env.WARA_V2_PILOT_KILL);
}

export function resolveVersionRoute(input: VersionRouterInput): RouterDecision {
  const env = input.env ?? process.env;

  if (isVersionRouterKillSwitch(env)) {
    return { route: "v1", reason: "kill_switch_active" };
  }

  if (!isVersionRouterEnabled(env)) {
    return { route: "v1", reason: "router_disabled_default_v1" };
  }

  const allowlist = parseExactPhoneAllowlist(env.WARA_V2_ROUTER_ALLOWLIST ?? env.WARA_V2_SHADOW_ALLOWLIST ?? "");
  const tenant = (env.WARA_V2_ROUTER_TENANT ?? env.WARA_V2_SHADOW_TENANT ?? "tenant_internal_ops").trim();

  if (input.tenantId !== tenant) {
    return { route: "v1", reason: "tenant_not_routed_to_v2" };
  }

  if (allowlist.length === 0 || !isPhoneAllowlisted(input.phoneE164, allowlist)) {
    return { route: "v1", reason: "phone_not_in_v2_allowlist" };
  }

  const caps = (env.WARA_V2_ROUTER_CAPABILITIES ?? "*")
    .split(",")
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean);
  if (input.capability && caps[0] !== "*" && !caps.includes(input.capability.toLowerCase())) {
    return { route: "v1", reason: "capability_not_routed" };
  }

  return { route: "v2", reason: "allowlisted_v2" };
}

/** Antes de cualquier efecto externo: nunca fallback a V1 si V2 inició write. */
export function forbidFallbackAfterV2Write(input: {
  v2WriteStarted: boolean;
  fallbackRequested: boolean;
}): boolean {
  if (input.v2WriteStarted && input.fallbackRequested) return true;
  return false;
}

export type RouterMetrics = {
  v1_turns: number;
  v2_turns: number;
  v2_blocked: number;
  by_tramite: Record<string, number>;
};

const metrics: RouterMetrics = {
  v1_turns: 0,
  v2_turns: 0,
  v2_blocked: 0,
  by_tramite: {},
};

export function recordRouterMetric(decision: RouterDecision, tramite?: string): void {
  if (decision.route === "v1") metrics.v1_turns += 1;
  if (decision.route === "v2") metrics.v2_turns += 1;
  if (decision.route === "blocked") metrics.v2_blocked += 1;
  if (tramite) metrics.by_tramite[tramite] = (metrics.by_tramite[tramite] ?? 0) + 1;
}

export function getRouterMetrics(): RouterMetrics {
  return { ...metrics, by_tramite: { ...metrics.by_tramite } };
}

export function resetRouterMetricsForTests(): void {
  metrics.v1_turns = 0;
  metrics.v2_turns = 0;
  metrics.v2_blocked = 0;
  metrics.by_tramite = {};
}
