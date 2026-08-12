/**
 * Cliente Odoo Helpdesk V2 — payload compatible con V1 createHelpdeskTicket.
 * Escrituras bloqueadas salvo ALLOW_EXTERNAL_MUTATIONS=true.
 */
import { getOdooConfigStatus } from "./odoo-status.js";
import type { MaintenancePriority } from "./maintenance-types.js";
import type { TicketCategory } from "./ticket-types.js";

export type OdooTicketPayload = {
  subject: string;
  description: string;
  customerName?: string;
  customerPhone?: string;
  companyName?: string;
  priority?: string;
  category?: TicketCategory;
  dedupeKey?: string;
  extra?: Record<string, unknown>;
};

export type CreateOdooTicketDryRunResult =
  | { ok: true; dryRun: true; payload: OdooTicketPayload; simulatedTicketId: number; simulatedRef: string }
  | { ok: true; dryRun: false; payload: OdooTicketPayload; ticketId: number; ref: string | null }
  | { ok: false; error: string; payload: OdooTicketPayload };

function mapPriority(priority: MaintenancePriority | string): string {
  const p = String(priority).toUpperCase();
  if (p === "URGENT") return "3";
  if (p === "HIGH") return "2";
  if (p === "LOW") return "0";
  return "1";
}

export function buildOdooHelpdeskPayload(input: OdooTicketPayload): Record<string, unknown> {
  const values: Record<string, unknown> = {
    name: input.subject.trim(),
  };
  if (input.priority?.trim()) values.priority = mapPriority(input.priority);
  if (input.description?.trim()) {
    values.description = input.description.trim();
  }
  if (input.companyName?.trim() || input.customerName?.trim()) {
    values.partner_name = (input.companyName ?? input.customerName ?? "").trim();
  }
  if (input.customerPhone?.trim()) values.partner_phone = input.customerPhone.trim();
  if (input.extra) Object.assign(values, input.extra);
  return values;
}

let ticketIdSeq = 900_000;

export function resetOdooTicketIdSeqForTests(n = 900_000): void {
  ticketIdSeq = n;
}

export async function createOdooHelpdeskTicketDryRun(
  input: OdooTicketPayload,
  env: NodeJS.ProcessEnv = process.env,
): Promise<CreateOdooTicketDryRunResult> {
  const payload = input;
  const odooValues = buildOdooHelpdeskPayload(payload);
  const dryRun = env.ALLOW_EXTERNAL_MUTATIONS !== "true";

  if (dryRun) {
    ticketIdSeq += 1;
    const simulatedRef = `DRY-${ticketIdSeq}`;
    return {
      ok: true,
      dryRun: true,
      payload,
      simulatedTicketId: ticketIdSeq,
      simulatedRef,
    };
  }

  const cfg = getOdooConfigStatus(env);
  if (!cfg.configured) {
    return { ok: false, error: `Odoo no configurado: ${cfg.missing.join(", ")}`, payload };
  }

  return {
    ok: false,
    error: "Escritura Odoo real no implementada en piloto V2 (usar V1)",
    payload,
  };
}
