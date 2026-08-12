/**
 * Cliente HTTP WARA read-only para piloto V2 (sin Prisma V1).
 */
import { digitsOnly } from "./phone.js";
import type {
  WaraConsultarEstadoUnidadesResult,
  WaraEmpresaContact,
  WaraEmpresaLookupResult,
  WaraUnidadEstado,
} from "./wara-types.js";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function normalizeWaraPhone(raw: string): string {
  return digitsOnly(raw);
}

function waraApiBaseUrl(env: NodeJS.ProcessEnv): string {
  return (
    env.WARA_API_BASE_URL?.trim() ||
    "https://apps.visionblo.com/rb/app/api_interna"
  ).replace(/\/+$/, "");
}

function waraMaintenanceApiBaseUrl(env: NodeJS.ProcessEnv): string {
  return (
    env.WARA_MAINTENANCE_API_BASE_URL?.trim() || waraApiBaseUrl(env)
  ).replace(/\/+$/, "");
}

function obtenerEmpresaToken(env: NodeJS.ProcessEnv): string {
  return env.WARA_OBTENER_EMPRESA_TOKEN?.trim() || "";
}

function waraData(json: Record<string, unknown> | null): Record<string, unknown> {
  if (json && typeof json.data === "object" && json.data !== null) {
    return json.data as Record<string, unknown>;
  }
  return json ?? {};
}

function errorFromWara(json: Record<string, unknown> | null, fallback: string): string {
  if (typeof json?.error === "string") return json.error;
  if (typeof json?.message === "string") return json.message;
  return fallback;
}

function normalizeContact(raw: unknown): WaraEmpresaContact | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === "number" ? o.id : typeof o.ID === "number" ? o.ID : null;
  if (id == null) return null;
  const nombre = String(o.nombre ?? o.Nombre ?? o.name ?? "").trim();
  const empresa = String(o.empresa ?? o.Empresa ?? o.company ?? nombre).trim();
  return { id, nombre: nombre || empresa, empresa: empresa || nombre };
}

async function obtenerEmpresaPorNumeroOnce(
  rawPhone: string,
  env: NodeJS.ProcessEnv,
): Promise<WaraEmpresaLookupResult> {
  const token = obtenerEmpresaToken(env);
  const telefono = normalizeWaraPhone(rawPhone);
  if (!token) {
    return {
      configured: false,
      ok: false,
      encontrado: false,
      contactos: [],
      error: "WARA_OBTENER_EMPRESA_TOKEN no configurado",
    };
  }
  if (telefono.length < 8) {
    return {
      configured: true,
      ok: false,
      encontrado: false,
      contactos: [],
      error: "Formato de teléfono inválido",
    };
  }

  const res = await fetch(`${waraApiBaseUrl(env)}/ObtenerContactosPorNumero`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, telefono }),
    cache: "no-store",
  });

  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) {
    return {
      configured: true,
      ok: false,
      encontrado: false,
      contactos: [],
      status: res.status,
      error: errorFromWara(json, `Wara respondió HTTP ${res.status}`),
    };
  }

  const contactosRaw: unknown[] = Array.isArray(json?.contactos)
    ? (json!.contactos as unknown[])
    : json?.contacto && typeof json.contacto === "object"
      ? [json.contacto]
      : [];

  const contactos = contactosRaw
    .map(normalizeContact)
    .filter((c): c is WaraEmpresaContact => c != null);

  const sessionToken =
    typeof json?.SessionToken === "string"
      ? json.SessionToken
      : typeof json?.sessionToken === "string"
        ? json.sessionToken
        : undefined;

  return {
    configured: true,
    ok: true,
    encontrado: json?.encontrado === true || contactos.length > 0,
    contactos,
    sessionToken,
    customerName:
      typeof json?.CustomerName === "string"
        ? json.CustomerName
        : typeof json?.customerName === "string"
          ? json.customerName
          : undefined,
    status: res.status,
  };
}

export async function obtenerEmpresaPorNumero(
  rawPhone: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<WaraEmpresaLookupResult> {
  const maxAttempts = 3;
  const backoffMs = [300, 800];
  let last: WaraEmpresaLookupResult | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await obtenerEmpresaPorNumeroOnce(rawPhone, env);
    last = result;
    if (result.ok && result.encontrado && result.contactos.length > 0) {
      return result;
    }
    if (!result.configured || (result.status === undefined && !result.ok)) {
      return result;
    }
    if (attempt < maxAttempts) {
      await sleep(backoffMs[attempt - 1] ?? 800);
    }
  }
  return last as WaraEmpresaLookupResult;
}

export async function createChatBotToken(
  contactId: number,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{
  ok: boolean;
  status: number;
  sessionToken?: string;
  error?: string;
}> {
  const token = obtenerEmpresaToken(env);
  if (!token) {
    return { ok: false, status: 503, error: "WARA_OBTENER_EMPRESA_TOKEN no configurado" };
  }

  const res = await fetch(`${waraApiBaseUrl(env)}/CreateChatBotToken`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, contacto_id: contactId }),
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });

  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  const data = waraData(json);
  const sessionToken =
    (typeof json?.SessionToken === "string" ? json.SessionToken : undefined) ??
    (typeof json?.sessionToken === "string" ? json.sessionToken : undefined) ??
    (typeof data.SessionToken === "string" ? (data.SessionToken as string) : undefined) ??
    (typeof data.sessionToken === "string" ? (data.sessionToken as string) : undefined);

  if (res.ok && sessionToken) {
    return { ok: true, status: res.status, sessionToken };
  }
  return {
    ok: false,
    status: res.status,
    error: errorFromWara(json, `CreateChatBotToken falló (${res.status})`),
  };
}

export async function consultarEstadoUnidades(
  sessionToken: string,
  env: NodeJS.ProcessEnv = process.env,
  patentes: string[] = [],
): Promise<WaraConsultarEstadoUnidadesResult> {
  const res = await fetch(`${waraMaintenanceApiBaseUrl(env)}/ConsultarEstadoUnidades`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${sessionToken}`,
    },
    body: JSON.stringify({ token: sessionToken, patentes }),
    cache: "no-store",
  });

  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      unidades: [],
      error: errorFromWara(json, `Wara respondió HTTP ${res.status}`),
    };
  }

  const data = waraData(json);
  return {
    ok: json?.ok !== false,
    status: res.status,
    cliente: typeof data.cliente === "string" ? data.cliente : undefined,
    unidades: Array.isArray(data.unidades) ? (data.unidades as WaraUnidadEstado[]) : [],
    error: json?.ok === false ? errorFromWara(json, "Wara no devolvió unidades") : undefined,
  };
}

export function isWaraReadConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return obtenerEmpresaToken(env).length > 0;
}
