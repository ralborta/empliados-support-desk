/**
 * Proxy opcional de /api/whatsapp/turn → cerebro V2 (Runtime Next / Commander V3).
 * BBC sigue llamando al mismo host; el backend reenvía a v2-shadow.
 */
import { normalizeWhatsAppPhone } from "@/lib/whatsappPhone";

function isTrue(v: string | undefined): boolean {
  return v === "true" || v === "1";
}

export function isWaraV2PilotTurnProxyEnabled(): boolean {
  return isTrue(process.env.WARA_CONVERSATION_RUNTIME_NEXT_PROXY?.trim());
}

function proxyAllowlistPhones(): string[] {
  const raw =
    process.env.WARA_CONVERSATION_RUNTIME_NEXT_PROXY_ALLOWLIST?.trim() ||
    process.env.WARA_V2_SHADOW_ALLOWLIST?.trim() ||
    "";
  if (!raw) return [];
  return raw
    .split(/[,\s]+/)
    .map((p) => normalizeWhatsAppPhone(p))
    .filter((p) => p.length >= 8);
}

function phoneMatchesAllowlist(rawPhone: string, allowlist: string[]): boolean {
  const n = normalizeWhatsAppPhone(rawPhone);
  if (!n) return false;
  if (allowlist.includes(n)) return true;
  if (n.startsWith("549")) {
    const without9 = "54" + n.slice(3);
    if (allowlist.includes(without9)) return true;
  } else if (n.startsWith("54")) {
    const with9 = "549" + n.slice(2);
    if (allowlist.includes(with9)) return true;
  }
  return false;
}

/** Proxy global ON + teléfono en allowlist (si hay lista configurada). */
export function isWaraV2PilotTurnProxyEnabledForPhone(rawPhone: string): boolean {
  if (!isWaraV2PilotTurnProxyEnabled()) return false;
  const allowlist = proxyAllowlistPhones();
  if (allowlist.length === 0) return false;
  return phoneMatchesAllowlist(rawPhone, allowlist);
}

function pilotTurnEndpoint(): string | null {
  const explicit = process.env.WARA_V2_PILOT_TURN_URL?.trim();
  if (explicit) {
    return explicit.endsWith("/api/whatsapp/turn")
      ? explicit
      : `${explicit.replace(/\/$/, "")}/api/whatsapp/turn`;
  }
  const shadow = process.env.WARA_V2_SHADOW_URL?.trim();
  if (!shadow) return null;
  const base = shadow.replace(/\/v2\/shadow-canary\/?$/, "").replace(/\/$/, "");
  return `${base}/api/whatsapp/turn`;
}

export async function proxyWhatsAppTurnToV2Pilot(input: {
  phone: string;
  body: string;
  apiKey: string;
}): Promise<Record<string, unknown>> {
  const url = pilotTurnEndpoint();
  if (!url) {
    return {
      ok: false,
      ok_s: "false",
      error: "v2_pilot_url_missing",
      message: "",
      skipResponse_s: "true",
    };
  }

  const timeoutMs = Number(process.env.WARA_V2_PILOT_TURN_TIMEOUT_MS ?? "55000");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": input.apiKey,
      },
      body: JSON.stringify({
        phone: input.phone,
        from: input.phone,
        body: input.body,
        rawText: input.body,
        message: input.body,
        api_key: input.apiKey,
      }),
      signal: controller.signal,
    });

    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return {
        ok: false,
        ok_s: "false",
        error: "v2_pilot_proxy_http",
        proxy_status: res.status,
        message: "",
        skipResponse_s: "true",
        engine: "wara-v2-proxy",
      };
    }
    return { ...data, engine: data.engine ?? "wara-v2-proxy" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      ok_s: "false",
      error: msg.includes("abort") ? "v2_pilot_proxy_timeout" : "v2_pilot_proxy_error",
      message: "",
      skipResponse_s: "true",
      engine: "wara-v2-proxy",
    };
  } finally {
    clearTimeout(timer);
  }
}
