/**
 * Cliente Odoo Helpdesk V2 — payload compatible con V1 createHelpdeskTicket.
 * Escrituras bloqueadas salvo WARA_V2_ODOO_WRITE_ENABLED=true.
 */
import type { MaintenancePriority } from "./maintenance-types.js";
import type { TicketCategory } from "./ticket-types.js";
import { isOdooWriteEnabled } from "./write-gates.js";
import { createHelpdeskTicketReal } from "./odoo-api-real.js";

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
  const gateEnabled = isOdooWriteEnabled(env);
  const legacyBlock = env.ALLOW_EXTERNAL_MUTATIONS !== "true";

  if (!gateEnabled || legacyBlock) {
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

  try {
    const real = await createHelpdeskTicketReal(
      {
        subject: payload.subject,
        description: payload.description,
        customerName: payload.customerName,
        customerPhone: payload.customerPhone,
        companyName: payload.companyName,
        priority: payload.priority,
      },
      env,
    );
    return {
      ok: true,
      dryRun: false,
      payload,
      ticketId: real.ticketId,
      ref: real.ref,
    };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    if (/abort|timeout/i.test(err)) {
      return { ok: false, error: `timeout_after_send:${err}`, payload };
    }
    return { ok: false, error: err, payload };
  }
}
