/**
 * Puente opcional hacia tickets locales V1 (Prisma prod) — deshabilitado por defecto.
 */
import { isOdooWriteEnabled } from "./write-gates.js";

export type V1LocalTicketInput = {
  customerId: string;
  contactName: string;
  title: string;
  messageText: string;
  priority?: string;
  messagePayload?: Record<string, unknown>;
};

export type V1LocalTicketResult =
  | { ok: true; ticketId: string; ticketCode: string; created: boolean; autoAssigned: boolean }
  | { ok: false; error: string; skipped: true };

export async function createV1LocalTicketIfEnabled(
  _input: V1LocalTicketInput,
  env: NodeJS.ProcessEnv = process.env,
): Promise<V1LocalTicketResult> {
  if (!isOdooWriteEnabled(env)) {
    return { ok: false, error: "WARA_V2_ODOO_WRITE_ENABLED=false", skipped: true };
  }
  if (env.WARA_V2_V1_TICKET_BRIDGE_ENABLED !== "true") {
    return {
      ok: false,
      error: "WARA_V2_V1_TICKET_BRIDGE_ENABLED=false (Operation V2 es registro primario)",
      skipped: true,
    };
  }
  return {
    ok: false,
    error: "Bridge V1 no activado en esta entrega",
    skipped: true,
  };
}
