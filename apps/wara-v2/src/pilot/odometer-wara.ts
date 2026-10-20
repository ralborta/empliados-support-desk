/**
 * Cliente WARA odómetro/horómetro V2 — mismo endpoint y payload que V1.
 */
import type { MeterType, OdometerWaraPayload } from "./odometer-types.js";
import { fechaLocalNaiveToWaraUtc } from "./odometer-core.js";
import { plateCandidatesForWaraApi } from "./plates.js";
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
  const fecha = fechaLocalNaiveToWaraUtc(
    input.fechaLocalIso,
    input.timezone ?? "America/Argentina/Buenos_Aires",
  );
  // Usá la patente tal cual (flota). No forzar espacios: Visionblo busca exacto.
  const patente = input.patente.trim();
  const body: OdometerWaraPayload = {
    token: input.sessionToken,
    patente,
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

function looksLikePlateNotFound(err: string): boolean {
  return /no se encontr|no encontr|veh[ií]culo|patente|unidad/i.test(err);
}

async function postRegister(
  payload: OdometerWaraPayload,
  sessionToken: string,
  env: NodeJS.ProcessEnv,
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const res = await fetch(
    `${waraMaintenanceApiBaseUrl(env)}/RegistrarCambioOdometroHorometro`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: AbortSignal.timeout(Number(env.WARA_API_TIMEOUT_MS ?? 15_000)),
    },
  ).catch((e: unknown) => {
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
    return { ok: false, error: err, status: res.status };
  }
  return { ok: true };
}

export async function registerOdometerHorometro(
  input: {
    sessionToken: string;
    patente: string;
    /** Patente cruda de flota WARA (preferida). */
    fleetPatente?: string | null;
    meterType: MeterType;
    value: number;
    fechaLocalIso: string;
  },
  env: NodeJS.ProcessEnv = process.env,
): Promise<RegisterOdometerResult> {
  const gateEnabled = isOdometerWriteEnabled(env);
  const candidates = plateCandidatesForWaraApi(
    input.patente,
    input.fleetPatente ?? null,
  );
  const primary = buildOdometerWaraPayload({
    ...input,
    patente: candidates[0] ?? input.patente,
  });

  if (!gateEnabled) {
    return {
      ok: true,
      dryRun: true,
      payload: primary,
      summary: `dry-run: payload listo para RegistrarCambioOdometroHorometro`,
    };
  }

  let lastError = "WARA no registró el cambio";
  let lastPayload = primary;

  for (const patente of candidates) {
    const payload = buildOdometerWaraPayload({ ...input, patente });
    lastPayload = payload;
    const res = await postRegister(payload, input.sessionToken, env);
    if (res.ok) {
      return {
        ok: true,
        dryRun: false,
        payload,
        summary: "registrado en WARA",
      };
    }
    lastError = res.error;
    // Solo reintentar con otro formato de patente si parece "no encontrada".
    if (!looksLikePlateNotFound(res.error)) {
      return { ok: false, error: lastError, payload };
    }
  }

  return { ok: false, error: lastError, payload: lastPayload };
}
