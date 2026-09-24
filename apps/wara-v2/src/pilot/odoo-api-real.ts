/**
 * Cliente Odoo JSON-RPC real para V2 — portado de V1 odooApi.ts (subset Helpdesk).
 * Solo invocable con WARA_V2_ODOO_WRITE_ENABLED=true.
 */
import { getOdooConfigStatus } from "./odoo-status.js";
import { assertWriteGate } from "./write-gates.js";

export type OdooConfig = {
  url: string;
  db: string;
  email: string;
  apiKey: string;
  helpdeskTeamId: number | null;
  helpdeskStageId: number | null;
};

export type CreateOdooTicketInput = {
  subject: string;
  description?: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  companyName?: string;
  priority?: string;
  teamId?: number;
  stageId?: number;
  extra?: Record<string, unknown>;
};

export type CreateOdooTicketResult = {
  ok: true;
  ticketId: number;
  ref: string | null;
  url: string;
};

function readEnv(name: string): string {
  return (process.env[name] ?? "").trim();
}

function readNumberEnv(name: string): number | null {
  const raw = readEnv(name);
  return raw && Number.isFinite(Number(raw)) ? Number(raw) : null;
}

export function getOdooConfig(env: NodeJS.ProcessEnv = process.env): OdooConfig | null {
  const url = (env.ODOO_URL ?? "").trim().replace(/\/+$/, "");
  const db = (env.ODOO_DB ?? "").trim();
  const email = (env.ODOO_EMAIL ?? "").trim();
  const apiKey = (env.ODOO_API_KEY ?? "").trim();
  if (!url || !db || !email || !apiKey) return null;
  return {
    url,
    db,
    email,
    apiKey,
    helpdeskTeamId: readNumberEnv("ODOO_HELPDESK_TEAM_ID"),
    helpdeskStageId: readNumberEnv("ODOO_HELPDESK_STAGE_ID"),
  };
}

function mapPriority(priority: string): string {
  const p = priority.toUpperCase();
  if (p === "URGENT" || p === "3") return "3";
  if (p === "HIGH" || p === "2") return "2";
  if (p === "LOW" || p === "0") return "0";
  return "1";
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function odooJsonRpc<T>(
  cfg: OdooConfig,
  service: string,
  method: string,
  args: unknown[],
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(process.env.ODOO_TIMEOUT_MS ?? 20_000));
  try {
    const res = await fetch(`${cfg.url}/jsonrpc`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "call",
        params: { service, method, args },
        id: Date.now(),
      }),
      signal: controller.signal,
    });
    const json = (await res.json()) as { result?: T; error?: { message?: string } };
    if (json.error) throw new Error(json.error.message ?? "Odoo JSON-RPC error");
    return json.result as T;
  } finally {
    clearTimeout(timer);
  }
}

async function odooAuthenticate(cfg: OdooConfig): Promise<number> {
  const uid = await odooJsonRpc<number>(cfg, "common", "authenticate", [
    cfg.db,
    cfg.email,
    cfg.apiKey,
    {},
  ]);
  if (!uid) throw new Error("Odoo authenticate failed");
  return uid;
}

async function odooExecuteKw<T>(
  cfg: OdooConfig,
  model: string,
  method: string,
  args: unknown[],
  kwargs: Record<string, unknown> = {},
): Promise<T> {
  const uid = await odooAuthenticate(cfg);
  return odooJsonRpc<T>(cfg, "object", "execute_kw", [cfg.db, uid, cfg.apiKey, model, method, args, kwargs]);
}

export async function createHelpdeskTicketReal(
  input: CreateOdooTicketInput,
  env: NodeJS.ProcessEnv = process.env,
): Promise<CreateOdooTicketResult> {
  assertWriteGate("odoo", env);
  const cfg = getOdooConfig(env);
  if (!cfg) {
    const st = getOdooConfigStatus(env);
    throw new Error(`Odoo no configurado: ${st.missing.join(", ")}`);
  }

  const subject = input.subject.trim();
  const values: Record<string, unknown> = { name: subject };
  const teamId = input.teamId ?? cfg.helpdeskTeamId ?? undefined;
  const stageId = input.stageId ?? cfg.helpdeskStageId ?? undefined;
  if (teamId != null) values.team_id = teamId;
  if (stageId != null) values.stage_id = stageId;
  if (input.priority?.trim()) values.priority = mapPriority(input.priority);
  if (input.description?.trim()) {
    values.description = `<p>${escapeHtml(input.description.trim()).replace(/\n/g, "<br/>")}</p>`;
  }
  if (input.companyName?.trim() || input.customerName?.trim()) {
    values.partner_name = (input.companyName ?? input.customerName ?? "").trim();
  }
  if (input.customerEmail?.trim()) values.partner_email = input.customerEmail.trim();
  if (input.customerPhone?.trim()) values.partner_phone = input.customerPhone.trim();
  if (input.extra) Object.assign(values, input.extra);

  const ticketId = await odooExecuteKw<number>(cfg, "helpdesk.ticket", "create", [values]);
  let ref: string | null = null;
  try {
    const rows = await odooExecuteKw<Array<{ ticket_ref?: string }>>(cfg, "helpdesk.ticket", "read", [
      [ticketId],
      ["ticket_ref"],
    ]);
    ref = rows?.[0]?.ticket_ref ?? null;
  } catch {
    ref = null;
  }
  return { ok: true, ticketId, ref, url: `${cfg.url}/odoo/all-tickets/${ticketId}` };
}
