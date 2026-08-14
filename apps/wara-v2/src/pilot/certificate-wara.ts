/**
 * Cliente WARA certificado de cobertura V2 — mismo endpoint que V1.
 */
import type { CertificateWaraPayload } from "./certificate-types.js";
import { formatPlateWithSpaces, normalizeLoosePlate } from "./plates.js";
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
  // Visionblo exige patente con espacios (ej. "AA 496 GN"); sin espacios → "Unidad no encontrada".
  const spaced =
    formatPlateWithSpaces(normalizeLoosePlate(input.patente)) ||
    input.patente.trim();
  return {
    token: input.sessionToken,
    patente: spaced,
  };
}

export type IssueCertificateResult =
  | { ok: true; dryRun: true; payload: CertificateWaraPayload; summary: string }
  | { ok: true; dryRun: false; payload: CertificateWaraPayload; url?: string; summary: string }
  | { ok: false; error: string; payload: CertificateWaraPayload };

function firstString(data: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

export async function issueCertificadoCobertura(
  input: { sessionToken: string; patente: string },
  env: NodeJS.ProcessEnv = process.env,
): Promise<IssueCertificateResult> {
  const payload = buildCertificateWaraPayload(input);
  const gateEnabled = isCertificateWriteEnabled(env);

  // Gate específico controla la escritura. No exigir ALLOW_EXTERNAL_MUTATIONS
  // (shadow lab lo tiene en false a propósito; el flag de certificado basta).
  if (!gateEnabled) {
    return {
      ok: true,
      dryRun: true,
      payload,
      summary: "dry-run: payload listo para Certificadocobertura",
    };
  }

  const res = await fetch(`${waraMaintenanceApiBaseUrl(env)}/Certificadocobertura`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.sessionToken}`,
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
    return { ok: false, error: err, payload };
  }

  const data =
    json && typeof json.data === "object" && json.data !== null
      ? (json.data as Record<string, unknown>)
      : (json ?? {});
  const url = firstString(data, ["url", "URL", "link", "Link", "certificado_url", "certificadoUrl"]);
  return {
    ok: true,
    dryRun: false,
    payload,
    url,
    summary: url ? "certificado generado" : "certificado generado sin URL",
  };
}
