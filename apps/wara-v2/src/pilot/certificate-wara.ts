/**
 * Cliente WARA certificado de cobertura V2 — mismo endpoint que V1.
 */
import type { CertificateWaraPayload } from "./certificate-types.js";
import { plateCandidatesForWaraApi } from "./plates.js";
import { isCertificateWriteEnabled } from "./write-gates.js";

function waraMaintenanceApiBaseUrl(env: NodeJS.ProcessEnv): string {
  return (
    env.WARA_MAINTENANCE_API_BASE_URL?.trim() ||
    env.WARA_API_BASE_URL?.trim() ||
    "https://apps.visionblo.com/rb/app/api_interna"
  ).replace(/\/+$/, "");
}

export function buildCertificateWaraPayload(input: {
  sessionToken: string;
  patente: string;
}): CertificateWaraPayload {
  // Patente tal cual (flota). No forzar espacios: algunas unidades fallan con "Unidad no encontrada".
  return {
    token: input.sessionToken,
    patente: input.patente.trim(),
  };
}

export type IssueCertificateResult =
  | { ok: true; dryRun: true; payload: CertificateWaraPayload; summary: string }
  | {
      ok: true;
      dryRun: false;
      payload: CertificateWaraPayload;
      url?: string;
      summary: string;
    }
  | { ok: false; error: string; payload: CertificateWaraPayload };

function firstString(data: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function looksLikeUnitNotFound(err: string): boolean {
  return /no se encontr|no encontr|veh[ií]culo|patente|unidad/i.test(err);
}

async function postCertificate(
  payload: CertificateWaraPayload,
  sessionToken: string,
  env: NodeJS.ProcessEnv,
): Promise<
  | { ok: true; url?: string }
  | { ok: false; error: string }
> {
  const res = await fetch(`${waraMaintenanceApiBaseUrl(env)}/Certificadocobertura`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${sessionToken}`,
    },
    body: JSON.stringify(payload),
    cache: "no-store",
    signal: AbortSignal.timeout(Number(env.WARA_API_TIMEOUT_MS ?? 15_000)),
  }).catch((e: unknown) => {
    const err = e instanceof Error ? e.message : String(e);
    if (/abort|timeout/i.test(err)) {
      throw new Error(`timeout_after_send:${err}`);
    }
    throw e;
  });

  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok || json?.ok === false) {
    const err =
      (typeof json?.error === "string" && json.error) ||
      (typeof json?.message === "string" && json.message) ||
      `WARA HTTP ${res.status}`;
    return { ok: false, error: err };
  }

  const data =
    json && typeof json.data === "object" && json.data !== null
      ? (json.data as Record<string, unknown>)
      : (json ?? {});
  const url = firstString(data, [
    "url",
    "URL",
    "link",
    "Link",
    "certificado_url",
    "certificadoUrl",
  ]);
  return { ok: true, url };
}

export async function issueCertificadoCobertura(
  input: {
    sessionToken: string;
    patente: string;
    /** Patente cruda de flota WARA (preferida, igual que odómetro). */
    fleetPatente?: string | null;
  },
  env: NodeJS.ProcessEnv = process.env,
): Promise<IssueCertificateResult> {
  const gateEnabled = isCertificateWriteEnabled(env);
  const candidates = plateCandidatesForWaraApi(
    input.patente,
    input.fleetPatente ?? null,
  );
  const primary = buildCertificateWaraPayload({
    sessionToken: input.sessionToken,
    patente: candidates[0] ?? input.patente,
  });

  // Gate específico controla la escritura. No exigir ALLOW_EXTERNAL_MUTATIONS
  // (shadow lab lo tiene en false a propósito; el flag de certificado basta).
  if (!gateEnabled) {
    return {
      ok: true,
      dryRun: true,
      payload: primary,
      summary: "dry-run: payload listo para Certificadocobertura",
    };
  }

  let lastError = "WARA no generó el certificado";
  let lastPayload = primary;

  for (const patente of candidates) {
    const payload = buildCertificateWaraPayload({
      sessionToken: input.sessionToken,
      patente,
    });
    lastPayload = payload;
    const res = await postCertificate(payload, input.sessionToken, env);
    if (res.ok) {
      return {
        ok: true,
        dryRun: false,
        payload,
        url: res.url,
        summary: res.url ? "certificado generado" : "certificado generado sin URL",
      };
    }
    lastError = res.error;
    if (!looksLikeUnitNotFound(res.error)) {
      return { ok: false, error: lastError, payload };
    }
  }

  return { ok: false, error: lastError, payload: lastPayload };
}
