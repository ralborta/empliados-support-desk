/**
 * Cliente Odoo (JSON-RPC) para registrar tickets de reclamo en Helpdesk.
 *
 * Usa el endpoint /jsonrpc de Odoo (Online/Enterprise 18.0), sin dependencias
 * extra: solo `fetch`. La autenticación es con email + API key (la API key
 * de Odoo se usa como "password" en common.authenticate).
 *
 * Variables de entorno:
 *   ODOO_URL              ej. https://wara-v1.odoo.com
 *   ODOO_DB               ej. marionumza-wara-v1-main-22901455
 *   ODOO_EMAIL            ej. soportewara@waragps.com
 *   ODOO_API_KEY          API key del usuario
 *   ODOO_HELPDESK_TEAM_ID (opcional) id del equipo de Helpdesk por defecto
 */

export type OdooConfig = {
  url: string;
  db: string;
  email: string;
  apiKey: string;
  helpdeskTeamId: number | null;
};

export type OdooConfigStatus = {
  configured: boolean;
  missing: string[];
  url: string | null;
  db: string | null;
  email: string | null;
  helpdeskTeamId: number | null;
};

function readEnv(name: string): string {
  return (process.env[name] ?? "").trim();
}

/** Devuelve la config si está completa; null si falta algo. */
export function getOdooConfig(): OdooConfig | null {
  const url = readEnv("ODOO_URL").replace(/\/+$/, "");
  const db = readEnv("ODOO_DB");
  const email = readEnv("ODOO_EMAIL");
  const apiKey = readEnv("ODOO_API_KEY");
  if (!url || !db || !email || !apiKey) return null;
  const teamRaw = readEnv("ODOO_HELPDESK_TEAM_ID");
  const teamId = teamRaw && Number.isFinite(Number(teamRaw)) ? Number(teamRaw) : null;
  return { url, db, email, apiKey, helpdeskTeamId: teamId };
}

/** Estado de configuración para diagnóstico (sin exponer la API key). */
export function getOdooConfigStatus(): OdooConfigStatus {
  const url = readEnv("ODOO_URL").replace(/\/+$/, "") || null;
  const db = readEnv("ODOO_DB") || null;
  const email = readEnv("ODOO_EMAIL") || null;
  const apiKey = readEnv("ODOO_API_KEY");
  const teamRaw = readEnv("ODOO_HELPDESK_TEAM_ID");
  const missing: string[] = [];
  if (!url) missing.push("ODOO_URL");
  if (!db) missing.push("ODOO_DB");
  if (!email) missing.push("ODOO_EMAIL");
  if (!apiKey) missing.push("ODOO_API_KEY");
  return {
    configured: missing.length === 0,
    missing,
    url,
    db,
    email,
    helpdeskTeamId: teamRaw && Number.isFinite(Number(teamRaw)) ? Number(teamRaw) : null,
  };
}

export class OdooError extends Error {
  constructor(message: string, readonly detail?: unknown) {
    super(message);
    this.name = "OdooError";
  }
}

type JsonRpcResponse<T> = {
  jsonrpc: string;
  id: number | null;
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: { name?: string; message?: string; debug?: string };
  };
};

/** Llamada JSON-RPC genérica a un servicio Odoo (common/object/db). */
async function jsonRpc<T>(
  cfg: OdooConfig,
  service: string,
  method: string,
  args: unknown[]
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${cfg.url}/jsonrpc`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "call",
        params: { service, method, args },
      }),
    });
  } catch (e) {
    throw new OdooError(`No pude conectar con Odoo (${cfg.url}).`, String(e));
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new OdooError(`Odoo respondió HTTP ${res.status}.`, text.slice(0, 500));
  }

  const body = (await res.json().catch(() => null)) as JsonRpcResponse<T> | null;
  if (!body) throw new OdooError("Respuesta de Odoo no es JSON válido.");
  if (body.error) {
    const msg = body.error.data?.message || body.error.message || "Error de Odoo";
    throw new OdooError(msg, body.error.data ?? body.error);
  }
  return body.result as T;
}

/** Versión del servidor Odoo (no requiere autenticación). */
export async function odooVersion(cfg: OdooConfig): Promise<Record<string, unknown>> {
  return jsonRpc(cfg, "common", "version", []);
}

let cachedUid: { url: string; db: string; email: string; uid: number } | null = null;

/** Autentica y devuelve el uid (cacheado por proceso para no reautenticar en cada llamada). */
export async function odooAuthenticate(cfg: OdooConfig): Promise<number> {
  if (
    cachedUid &&
    cachedUid.url === cfg.url &&
    cachedUid.db === cfg.db &&
    cachedUid.email === cfg.email
  ) {
    return cachedUid.uid;
  }
  const uid = await jsonRpc<number | false>(cfg, "common", "authenticate", [
    cfg.db,
    cfg.email,
    cfg.apiKey,
    {},
  ]);
  if (!uid || typeof uid !== "number") {
    throw new OdooError("Autenticación con Odoo falló: revisá ODOO_EMAIL / ODOO_API_KEY / ODOO_DB.");
  }
  cachedUid = { url: cfg.url, db: cfg.db, email: cfg.email, uid };
  return uid;
}

/** Ejecuta un método sobre un modelo de Odoo (execute_kw). */
export async function odooExecuteKw<T>(
  cfg: OdooConfig,
  model: string,
  method: string,
  args: unknown[],
  kwargs: Record<string, unknown> = {}
): Promise<T> {
  const uid = await odooAuthenticate(cfg);
  return jsonRpc<T>(cfg, "object", "execute_kw", [
    cfg.db,
    uid,
    cfg.apiKey,
    model,
    method,
    args,
    kwargs,
  ]);
}

/** Mapea nuestra prioridad de ticket a la escala de Helpdesk (0=baja … 3=urgente). */
function mapPriority(priority?: string | null): string {
  switch ((priority ?? "").toUpperCase()) {
    case "LOW":
      return "0";
    case "HIGH":
      return "2";
    case "URGENT":
      return "3";
    case "NORMAL":
    default:
      return "1";
  }
}

export type CreateOdooTicketInput = {
  /** Asunto del ticket (obligatorio). */
  subject: string;
  /** Descripción / cuerpo del reclamo (texto plano; se envía como HTML simple). */
  description?: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  priority?: string | null;
  /** Sobrescribe el equipo de Helpdesk; si no, usa ODOO_HELPDESK_TEAM_ID. */
  teamId?: number | null;
  /** Campos extra crudos para el create de Odoo. */
  extra?: Record<string, unknown>;
};

export type CreateOdooTicketResult = {
  ok: boolean;
  ticketId: number;
  /** Referencia legible si Odoo la genera (ticket_ref). */
  ref?: string | null;
  url: string;
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Crea un ticket de reclamo en Helpdesk y devuelve su id + URL al backoffice. */
export async function createHelpdeskTicket(
  cfg: OdooConfig,
  input: CreateOdooTicketInput
): Promise<CreateOdooTicketResult> {
  const subject = input.subject.trim();
  if (!subject) throw new OdooError("El ticket necesita un asunto (subject).");

  const teamId = input.teamId ?? cfg.helpdeskTeamId ?? undefined;

  const values: Record<string, unknown> = {
    name: subject,
    priority: mapPriority(input.priority),
  };
  if (teamId != null) values.team_id = teamId;
  if (input.description?.trim()) {
    values.description = `<p>${escapeHtml(input.description.trim()).replace(/\n/g, "<br/>")}</p>`;
  }
  if (input.customerName?.trim()) values.partner_name = input.customerName.trim();
  if (input.customerEmail?.trim()) values.partner_email = input.customerEmail.trim();
  if (input.customerPhone?.trim()) values.partner_phone = input.customerPhone.trim();
  if (input.extra) Object.assign(values, input.extra);

  const ticketId = await odooExecuteKw<number>(cfg, "helpdesk.ticket", "create", [values]);

  let ref: string | null = null;
  try {
    const rows = await odooExecuteKw<Array<{ ticket_ref?: string }>>(
      cfg,
      "helpdesk.ticket",
      "read",
      [[ticketId], ["ticket_ref"]]
    );
    ref = rows?.[0]?.ticket_ref ?? null;
  } catch {
    // ticket_ref puede no existir en todas las versiones; no es crítico.
  }

  return {
    ok: true,
    ticketId,
    ref,
    url: `${cfg.url}/odoo/helpdesk/${ticketId}`,
  };
}

/** Prueba de conexión completa: versión + uid + (opcional) equipos de Helpdesk. */
export async function odooDiagnostics(): Promise<{
  configured: boolean;
  config: OdooConfigStatus;
  version?: Record<string, unknown>;
  uid?: number;
  helpdeskAvailable?: boolean;
  teams?: Array<{ id: number; name: string }>;
  error?: string;
}> {
  const status = getOdooConfigStatus();
  const cfg = getOdooConfig();
  if (!cfg) return { configured: false, config: status };

  try {
    const version = await odooVersion(cfg);
    const uid = await odooAuthenticate(cfg);
    let teams: Array<{ id: number; name: string }> | undefined;
    let helpdeskAvailable = false;
    try {
      teams = await odooExecuteKw<Array<{ id: number; name: string }>>(
        cfg,
        "helpdesk.team",
        "search_read",
        [[]],
        { fields: ["id", "name"], limit: 50 }
      );
      helpdeskAvailable = true;
    } catch {
      helpdeskAvailable = false;
    }
    return { configured: true, config: status, version, uid, helpdeskAvailable, teams };
  } catch (e) {
    return {
      configured: true,
      config: status,
      error: e instanceof OdooError ? e.message : String(e),
    };
  }
}
