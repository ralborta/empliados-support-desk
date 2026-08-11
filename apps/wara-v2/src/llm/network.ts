/**
 * Política de red Fase 8 — solo api.openai.com, sin redirects.
 */
import {
  FIXED_OPENAI_ENDPOINT,
  FIXED_OPENAI_HOSTNAME,
} from "./flags.js";

export type AuthorizedFetchInit = {
  method: "POST";
  headers: Record<string, string>;
  body: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxResponseBytes?: number;
  /** Inyectable en tests. */
  fetchImpl?: typeof fetch;
};

export type NetworkAudit = {
  at: string;
  hostname: string;
  path: string;
  endpoint: string;
  method: string;
  status?: number;
  bytes?: number;
  redirected: false;
  redirect_rejected?: boolean;
};

const auditLog: NetworkAudit[] = [];

export function getNetworkAudit(): readonly NetworkAudit[] {
  return auditLog;
}

export function clearNetworkAudit(): void {
  auditLog.length = 0;
}

export function assertAuthorizedEndpoint(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("network_url_invalid");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("network_protocol_forbidden");
  }
  if (parsed.hostname !== FIXED_OPENAI_HOSTNAME) {
    throw new Error(`network_hostname_forbidden:${parsed.hostname}`);
  }
  if (parsed.href !== FIXED_OPENAI_ENDPOINT && parsed.origin + parsed.pathname !== FIXED_OPENAI_ENDPOINT) {
    // allow trailing nothing; reject query strings with secrets
    if (parsed.search) throw new Error("network_query_string_forbidden");
    if (parsed.origin + parsed.pathname !== new URL(FIXED_OPENAI_ENDPOINT).origin + new URL(FIXED_OPENAI_ENDPOINT).pathname) {
      throw new Error("network_path_forbidden");
    }
  }
  if (parsed.search) throw new Error("network_query_string_forbidden");
  if (url !== FIXED_OPENAI_ENDPOINT) {
    // Exact match required — no alternate DNS/paths
    const canon = new URL(FIXED_OPENAI_ENDPOINT);
    if (
      parsed.hostname !== canon.hostname ||
      parsed.pathname !== canon.pathname ||
      parsed.protocol !== canon.protocol
    ) {
      throw new Error("network_endpoint_mismatch");
    }
  }
  return parsed;
}

export async function authorizedOpenAiFetch(
  url: string,
  init: AuthorizedFetchInit,
): Promise<{ status: number; text: string; audit: NetworkAudit }> {
  const parsed = assertAuthorizedEndpoint(url);
  const timeoutMs = init.timeoutMs ?? 15_000;
  const maxBytes = init.maxResponseBytes ?? 64 * 1024;
  const fetchImpl = init.fetchImpl ?? fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  if (init.signal) {
    init.signal.addEventListener("abort", () => ctrl.abort(), { once: true });
  }

  const audit: NetworkAudit = {
    at: new Date().toISOString(),
    hostname: parsed.hostname,
    path: parsed.pathname,
    endpoint: FIXED_OPENAI_ENDPOINT,
    method: "POST",
    redirected: false,
  };

  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: init.headers,
      body: init.body,
      signal: ctrl.signal,
      redirect: "manual",
    });

    if (res.status >= 300 && res.status < 400) {
      audit.redirect_rejected = true;
      audit.status = res.status;
      auditLog.push(audit);
      throw new Error(`network_redirect_forbidden:${res.status}`);
    }

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) {
      throw new Error("network_response_too_large");
    }
    audit.status = res.status;
    audit.bytes = buf.length;
    auditLog.push(audit);
    return { status: res.status, text: buf.toString("utf8"), audit };
  } catch (e) {
    auditLog.push(audit);
    if (e instanceof Error && e.name === "AbortError") {
      throw new Error("llm_timeout");
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
