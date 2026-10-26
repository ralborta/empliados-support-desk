import type { PrismaClient } from "@prisma/client";
import { sendWhatsAppMessage } from "@/lib/builderbot";
import { looksLikeFleetWideOutageClaim } from "@/lib/waraApi";

const ALERT_EVENT_REASON = "fleet_outage_ops_whatsapp_alert";

/** Números ops (WA) para fallas masivas de flota. Env: coma/espacio/punto y coma. */
export function fleetOutageAlertPhones(): string[] {
  const raw = process.env.WARA_FLEET_OUTAGE_ALERT_PHONES?.trim() ?? "";
  if (!raw) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[,;\s]+/)) {
    const digits = part.replace(/\D/g, "");
    if (digits.length < 8 || seen.has(digits)) continue;
    seen.add(digits);
    out.push(digits);
  }
  return out;
}

function digitsPhone(value: string): string {
  return String(value ?? "").replace(/\D/g, "");
}

export function buildFleetOutageOpsAlertMessage(params: {
  customerPhone: string;
  customerName?: string;
  companyName?: string;
  ticketCode?: string;
  messageText: string;
}): string {
  const lines = [
    "🚨 Falla masiva de flota (Wara)",
    `Cliente: ${digitsPhone(params.customerPhone) || params.customerPhone}${
      params.customerName?.trim() ? ` (${params.customerName.trim()})` : ""
    }`,
  ];
  if (params.companyName?.trim()) lines.push(`Empresa: ${params.companyName.trim()}`);
  if (params.ticketCode?.trim()) lines.push(`Ticket: ${params.ticketCode.trim()}`);
  const msg = String(params.messageText ?? "").trim().slice(0, 400);
  if (msg) lines.push(`Mensaje: ${msg}`);
  lines.push("Derivado a asesor — no es consulta de una patente.");
  return lines.join("\n");
}

/**
 * Avisa por WhatsApp a números ops SOLO en reclamos de flota completa.
 * Una sola vez por ticket (ticketEvent). Si no hay env, no-op.
 */
export async function maybeNotifyFleetOutageOpsAlert(
  prisma: PrismaClient,
  params: {
    ticketId: string;
    customerPhone: string;
    customerName?: string;
    companyName?: string;
    ticketCode?: string;
    messageText: string;
  },
): Promise<{ sent: number; skipped: string }> {
  if (!looksLikeFleetWideOutageClaim(params.messageText)) {
    return { sent: 0, skipped: "not_fleet_wide" };
  }
  const phones = fleetOutageAlertPhones();
  if (!phones.length) return { sent: 0, skipped: "no_alert_phones" };

  const prior = await prisma.ticketEvent.findFirst({
    where: {
      ticketId: params.ticketId,
      type: "ESCALATED",
      payload: { path: ["reason"], equals: ALERT_EVENT_REASON },
    },
    select: { id: true },
  });
  if (prior) return { sent: 0, skipped: "already_alerted" };

  const customerDigits = digitsPhone(params.customerPhone);
  const body = buildFleetOutageOpsAlertMessage(params);
  let sent = 0;
  const errors: string[] = [];

  for (const number of phones) {
    if (customerDigits && number === customerDigits) continue;
    try {
      await sendWhatsAppMessage({ number, message: body });
      sent += 1;
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      errors.push(`${number}:${detail}`);
      console.error("[fleetOutageOpsAlert] send failed", number, e);
    }
  }

  if (sent > 0 || errors.length > 0) {
    await prisma.ticketEvent.create({
      data: {
        ticketId: params.ticketId,
        type: "ESCALATED",
        payload: {
          reason: ALERT_EVENT_REASON,
          sent,
          phones: phones.filter((p) => p !== customerDigits),
          errors: errors.length ? errors : undefined,
          customerPhone: customerDigits || undefined,
        },
      },
    });
  }

  return { sent, skipped: sent > 0 ? "" : errors.length ? "send_errors" : "no_recipients" };
}
