/**
 * Proxy seguro canary → producción inmutable (031dc5a).
 * Sin cookies, sin segundo salto, timeout corto, anti-recursión.
 */
import { isV1HotfixCanaryEnabled } from "@/lib/v1HotfixCanary";

export const CANARY_PROXY_HOP_HEADER = "x-wara-canary-proxy-hop";

/** Hostnames de alias que pueden repointar al candidato — prohibidos como fallback. */
const FORBIDDEN_FALLBACK_HOSTS = new Set([
  "wara.nivel41.com",
  "monitor.nivel41.com",
  "empliados-support-desk.vercel.app",
  "empliados-support-desk-nivel-41.vercel.app",
  "empliados-support-desk-git-main-nivel-41.vercel.app",
]);

/** Deployment URL inmutable de prod 031dc5a (2026-08-10). No usar alias. */
export const PRODUCTION_IMMUTABLE_FALLBACK_DEFAULT =
  "https://empliados-support-desk-6gz1ojaeu-nivel-41.vercel.app";

const DEPLOYMENT_URL_RE =
  /^https:\/\/empliados-support-desk-[a-z0-9]+-nivel-41\.vercel\.app\/?$/i;

export type FallbackUrlValidation =
  | { ok: true; url: string }
  | { ok: false; reason: string };

export function normalizeFallbackBaseUrl(raw: string | undefined): FallbackUrlValidation {
  const url = (raw ?? "").trim().replace(/\/+$/, "");
  if (!url) {
    return { ok: false, reason: "fallback_url_missing" };
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: "fallback_url_invalid" };
  }
  if (parsed.protocol !== "https:") {
    return { ok: false, reason: "fallback_url_must_be_https" };
  }
  const host = parsed.hostname.toLowerCase();
  if (FORBIDDEN_FALLBACK_HOSTS.has(host)) {
    return { ok: false, reason: "fallback_url_alias_forbidden" };
  }
  if (host.includes("nivel41.com")) {
    return { ok: false, reason: "fallback_url_alias_forbidden" };
  }
  if (!DEPLOYMENT_URL_RE.test(`${parsed.protocol}//${host}`)) {
    return { ok: false, reason: "fallback_url_must_be_vercel_deployment_host" };
  }
  return { ok: true, url: `${parsed.protocol}//${host}` };
}

export function resolveImmutableFallbackUrl(): FallbackUrlValidation {
  const explicit =
    process.env.WARA_V1_HOTFIX_CANARY_FALLBACK_URL?.trim() ||
    process.env.WARA_V1_PRODUCTION_IMMUTABLE_URL?.trim() ||
    PRODUCTION_IMMUTABLE_FALLBACK_DEFAULT;
  return normalizeFallbackBaseUrl(explicit);
}

export function hasCanaryProxyHop(headers: Headers | { get(name: string): string | null }): boolean {
  const v = headers.get(CANARY_PROXY_HOP_HEADER);
  return v === "1" || v === "true";
}

export type ProxyLoopCheck =
  | { ok: true }
  | { ok: false; status: number; body: Record<string, unknown> };

/** Bloquea ciclo candidato → fallback → candidato o segundo salto. */
export function checkCanaryProxyLoop(
  headers: Headers | { get(name: string): string | null },
): ProxyLoopCheck {
  if (!hasCanaryProxyHop(headers)) return { ok: true };
  if (isV1HotfixCanaryEnabled()) {
    return {
      ok: false,
      status: 508,
      body: {
        ok: false,
        ok_s: "false",
        error: "canary_proxy_loop_detected",
        message: "Solicitud ya proxied; canary activo no re-proxy.",
      },
    };
  }
  return { ok: true };
}

export type CanaryProxyInput = {
  fallbackBaseUrl: string;
  path: string;
  body: unknown;
  apiKey: string;
  timeoutMs?: number;
};

export type CanaryProxyResult =
  | { ok: true; status: number; json: Record<string, unknown> }
  | { ok: false; status: number; json: Record<string, unknown> };

const DEFAULT_PROXY_TIMEOUT_MS = 8_000;

export async function proxyCanaryToProductionFallback(
  input: CanaryProxyInput,
): Promise<CanaryProxyResult> {
  const timeoutMs = input.timeoutMs ?? DEFAULT_PROXY_TIMEOUT_MS;
  const url = `${input.fallbackBaseUrl.replace(/\/+$/, "")}${input.path.startsWith("/") ? input.path : `/${input.path}`}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    [CANARY_PROXY_HOP_HEADER]: "1",
  };
  if (input.apiKey) {
    headers["x-api-key"] = input.apiKey;
  }

  const bypass = process.env.WARA_V1_CANARY_FALLBACK_BYPASS_SECRET?.trim();
  if (bypass) {
    headers["x-vercel-protection-bypass"] = bypass;
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(input.body),
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (res.status >= 300 && res.status < 400) {
      return {
        ok: false,
        status: 502,
        json: {
          ok: false,
          ok_s: "false",
          error: "fallback_redirect_blocked",
          message: "Fallback producción devolvió redirect (posible SSO).",
        },
      };
    }

    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!json) {
      return {
        ok: false,
        status: 502,
        json: {
          ok: false,
          ok_s: "false",
          error: "fallback_invalid_json",
          message: "Fallback producción no respondió JSON.",
        },
      };
    }
    return { ok: true, status: res.status, json };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const timedOut = /abort|timeout/i.test(msg);
    return {
      ok: false,
      status: timedOut ? 504 : 502,
      json: {
        ok: false,
        ok_s: "false",
        error: timedOut ? "fallback_timeout" : "fallback_unreachable",
        message: timedOut
          ? "Fallback producción no respondió a tiempo."
          : "No pude contactar fallback producción.",
      },
    };
  }
}
