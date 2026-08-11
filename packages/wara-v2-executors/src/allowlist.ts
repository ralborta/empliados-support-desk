/**
 * Allowlist estricta de destinos simulador local.
 * Ninguna URL arbitraria puede pasar.
 */
import { URL } from "node:url";

export const LOCAL_SIMULATOR_DESTINATION_KEY = "local_simulator" as const;

const BLOCKED_HOST_FRAGMENTS = [
  "wara",
  "odoo",
  "whatsapp",
  "builderbot",
  "meta.com",
  "facebook",
  "nivel41",
  "railway",
  "vercel",
  "easypanel",
  "staging",
  "production",
  "prod",
];

export type AllowlistResult =
  | { ok: true; destinationKey: typeof LOCAL_SIMULATOR_DESTINATION_KEY; origin: string }
  | { ok: false; reason: string };

/**
 * Valida que la URL sea exclusivamente HTTP local de prueba.
 * @param allowedPorts — puertos efímeros del harness (obligatorio salvo loopback puro en tests).
 */
export function assertLocalSimulatorUrl(
  rawUrl: string,
  allowedPorts: ReadonlySet<number> | number[],
): AllowlistResult {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "invalid_url" };
  }

  if (url.protocol !== "http:") {
    return { ok: false, reason: "protocol_not_http_local" };
  }
  if (url.username || url.password) {
    return { ok: false, reason: "credentials_in_url" };
  }

  const host = url.hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost") {
    return { ok: false, reason: `host_not_loopback:${host}` };
  }

  for (const frag of BLOCKED_HOST_FRAGMENTS) {
    if (host.includes(frag) || url.href.toLowerCase().includes(frag)) {
      // 127.0.0.1 path may contain "prod" in path — only block hostname/env-like
      if (host.includes(frag)) {
        return { ok: false, reason: `blocked_host_fragment:${frag}` };
      }
    }
  }

  const port = url.port ? Number(url.port) : 80;
  const ports = allowedPorts instanceof Set ? allowedPorts : new Set(allowedPorts);
  if (!ports.has(port)) {
    return { ok: false, reason: `port_not_in_harness_allowlist:${port}` };
  }

  return {
    ok: true,
    destinationKey: LOCAL_SIMULATOR_DESTINATION_KEY,
    origin: `${url.protocol}//${url.hostname}:${port}`,
  };
}

/** Detecta variables de entorno peligrosas que no deben usarse como destino. */
export function assertNoRealServiceEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  const dangerous = [
    "WARA_API_URL",
    "WARA_BASE_URL",
    "ODOO_URL",
    "ODOO_BASE_URL",
    "WHATSAPP_TOKEN",
    "BBC_WEBHOOK_URL",
    "BUILDERBOT_API_URL",
    "DATABASE_URL", // V1 — never as effect destination
  ];
  const hits: string[] = [];
  for (const k of dangerous) {
    if (env[k] && String(env[k]).length > 0) {
      // Presence is ok for V1 DATABASE_URL on machine; we only flag if used as destination.
      // Report keys that look like external service URLs when non-empty for audit.
      if (k !== "DATABASE_URL") hits.push(k);
    }
  }
  return hits;
}

export function isRedirectForbidden(): true {
  return true;
}
