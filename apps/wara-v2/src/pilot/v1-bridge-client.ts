/**
 * Cliente HTTP hacia front-v2-lab bridge API (server-to-server).
 */
import type { V1LocalTicketInput, V1LocalTicketResult } from "./v1-local-ticket-bridge.js";

function bridgeBaseUrl(env: NodeJS.ProcessEnv): string | null {
  const raw = (env.WARA_V2_BRIDGE_BASE_URL ?? "").trim();
  return raw ? raw.replace(/\/+$/, "") : null;
}

function bridgeApiKey(env: NodeJS.ProcessEnv): string | null {
  const k = (env.WARA_V2_BRIDGE_API_KEY ?? "").trim();
  return k || null;
}

export async function postV2BridgeTicket(
  input: V1LocalTicketInput,
  env: NodeJS.ProcessEnv = process.env,
): Promise<V1LocalTicketResult> {
  const base = bridgeBaseUrl(env);
  const key = bridgeApiKey(env);
  if (!base || !key) {
    return { ok: false, error: "bridge_url_or_api_key_missing", skipped: true };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(env.WARA_V2_BRIDGE_TIMEOUT_MS ?? 12_000));

  try {
    const res = await fetch(`${base}/api/v2/bridge/ticket`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
      },
      body: JSON.stringify(input),
      signal: controller.signal,
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return {
        ok: false,
        error: String(json.error ?? `bridge_http_${res.status}`),
        skipped: Boolean(json.skipped),
      };
    }
    return {
      ok: true,
      ticketId: String(json.ticketId),
      ticketCode: String(json.ticketCode),
      created: Boolean(json.created),
      autoAssigned: Boolean(json.autoAssigned),
    };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    return { ok: false, error: err, skipped: true };
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchCustomerBotPauseStatus(
  phoneE164: string,
  tenantId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ botPaused: boolean }> {
  const base = bridgeBaseUrl(env);
  const key = bridgeApiKey(env);
  if (!base || !key) return { botPaused: false };

  const q = new URLSearchParams({ phone: phoneE164, tenantId });
  try {
    const res = await fetch(`${base}/api/v2/bridge/customer-status?${q}`, {
      headers: { "x-api-key": key },
      cache: "no-store",
      signal: AbortSignal.timeout(Number(env.WARA_V2_BRIDGE_TIMEOUT_MS ?? 8_000)),
    });
    if (!res.ok) return { botPaused: false };
    const json = (await res.json()) as { botPaused?: boolean };
    return { botPaused: Boolean(json.botPaused) };
  } catch {
    return { botPaused: false };
  }
}
