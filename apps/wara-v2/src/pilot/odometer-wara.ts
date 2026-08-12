/**
 * Cliente WARA odómetro/horómetro V2 — mismo endpoint y payload que V1.
 * Escrituras bloqueadas salvo ALLOW_EXTERNAL_MUTATIONS=true.
 */
import type { MeterType, OdometerWaraPayload } from "./odometer-types.js";
import { fechaLocalNaiveToWaraUtc } from "./odometer-core.js";
import { isOdometerWriteEnabled } from "./write-gates.js";

function waraMaintenanceApiBaseUrl(env: NodeJS.ProcessEnv): string {
  return (
    env.WARA_MAINTENANCE_API_BASE_URL?.trim() ||
    env.WARA_API_BASE_URL?.trim() ||
    "https://apps.visionblo.com/rb/app/api_interna"
  ).replace(/\/+$/, "");
}

export function buildOdometerWaraPayload(input: {
  sessionToken: string;
  patente: string;
  meterType: MeterType;
  value: number;
  fechaLocalIso: string;
  timezone?: string;
}): OdometerWaraPayload {
  const fecha = fechaLocalNaiveToWaraUtc(input.fechaLocalIso, input.timezone ?? "America/Argentina/Buenos_Aires");
  const body: OdometerWaraPayload = {
    token: input.sessionToken,
    patente: input.patente.replace(/\s+/g, "").toUpperCase(),
    fecha,
  };
  if (input.meterType === "horometro") body.horometro = input.value;
  else body.odometro = input.value;
  return body;
}

export type RegisterOdometerResult =
  | { ok: true; dryRun: true; payload: OdometerWaraPayload; summary: string }
  | { ok: true; dryRun: false; payload: OdometerWaraPayload; summary: string }
  | { ok: false; error: string; payload: OdometerWaraPayload };

export async function registerOdometerHorometro(
  input: {
    sessionToken: string;
    patente: string;
    meterType: MeterType;
    value: number;
    fechaLocalIso: string;
  },
  env: NodeJS.ProcessEnv = process.env,
): Promise<RegisterOdometerResult> {
  const payload = buildOdometerWaraPayload(input);
  const gateEnabled = isOdometerWriteEnabled(env);
  const legacyBlock = env.ALLOW_EXTERNAL_MUTATIONS !== "true";

  if (!gateEnabled || legacyBlock) {
    return {
      ok: true,
      dryRun: true,
      payload,
      summary: `dry-run: payload listo para RegistrarCambioOdometroHorometro`,
    };
  }

  const res = await fetch(`${waraMaintenanceApiBaseUrl(env)}/RegistrarCambioOdometroHorometro`, {
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
  return { ok: true, dryRun: false, payload, summary: "registrado en WARA" };
}
