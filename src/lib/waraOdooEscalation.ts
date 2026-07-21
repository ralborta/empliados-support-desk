import type { Prisma, PrismaClient } from "@prisma/client";
import { resolveOdooPartnerCompanyName } from "@/config/odooPartnerAliases";
import { createHelpdeskTicket, getOdooConfig } from "@/lib/odooApi";

type JsonPayload = Record<string, unknown>;
type DbClient = PrismaClient | Prisma.TransactionClient;

function payloadField(payload: unknown, key: string): string | null {
  if (!payload || typeof payload !== "object") return null;
  const value = (payload as JsonPayload)[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Evita duplicar casos Odoo para el mismo incidente en la misma conversación. */
export async function findExistingOdooRefForDedupe(
  client: DbClient,
  ticketId: string,
  dedupeKey: string,
): Promise<string | null> {
  const msgs = await client.ticketMessage.findMany({
    where: { ticketId },
    orderBy: { createdAt: "desc" },
    take: 64,
    select: { rawPayload: true },
  });

  for (const msg of msgs) {
    if (payloadField(msg.rawPayload, "odooDedupeKey") !== dedupeKey) continue;
    const ref = payloadField(msg.rawPayload, "odooRef");
    if (ref) return ref;
  }

  return null;
}

/** Razón social para Odoo: prioriza el cliente devuelto por la API Wara sobre alias cortos de sesión. */
export function pickOdooCompanyName(
  sessionCompanyName?: string | null,
  waraCliente?: string | null
): string {
  const raw = waraCliente?.trim() || sessionCompanyName?.trim() || "";
  return resolveOdooPartnerCompanyName(raw);
}

export type EnsureWaraOdooParams = {
  ticketId: string;
  dedupeKey: string;
  subject: string;
  description: string;
  customerName?: string;
  customerPhone?: string;
  companyName?: string;
  priority?: string;
  aiSummary?: string;
  messageSource?: string;
  messagePlate?: string;
  logContext?: string;
};

/**
 * Crea ticket Odoo en escalaciones Wara aunque el ticket local se reutilice.
 * Si ya existe Odoo para la misma dedupeKey en el hilo, devuelve la ref previa.
 */
export async function ensureWaraOdooTicket(
  client: DbClient,
  params: EnsureWaraOdooParams,
): Promise<{ odooRef: string | null; created: boolean }> {
  const cached = await findExistingOdooRefForDedupe(client, params.ticketId, params.dedupeKey);
  if (cached) return { odooRef: cached, created: false };

  const odooCfg = getOdooConfig();
  if (!odooCfg) return { odooRef: null, created: false };

  try {
    const odoo = await createHelpdeskTicket(odooCfg, {
      subject: params.subject,
      description: params.description,
      customerName: params.customerName,
      customerPhone: params.customerPhone,
      companyName: params.companyName,
      priority: params.priority,
    });
    const odooRef = odoo.ref ?? String(odoo.ticketId);

    if (params.aiSummary) {
      await client.ticket.update({
        where: { id: params.ticketId },
        data: { aiSummary: params.aiSummary },
      });
    }

    const recentInbound = await client.ticketMessage.findMany({
      where: {
        ticketId: params.ticketId,
        direction: "INBOUND",
      },
      orderBy: { createdAt: "desc" },
      take: 12,
      select: { id: true, rawPayload: true },
    });

    const plateNorm = params.messagePlate?.trim().toUpperCase() ?? "";
    const match =
      recentInbound.find((msg) => {
        if (params.messageSource) {
          const source = payloadField(msg.rawPayload, "source");
          if (source !== params.messageSource) return false;
        }
        if (!plateNorm) return true;
        const plate = payloadField(msg.rawPayload, "plate")?.toUpperCase() ?? "";
        return plate === plateNorm;
      }) ?? recentInbound[0];

    if (match) {
      const prev = (match.rawPayload as JsonPayload | null) ?? {};
      await client.ticketMessage.update({
        where: { id: match.id },
        data: {
          rawPayload: {
            ...prev,
            odooDedupeKey: params.dedupeKey,
            odooRef,
            odooTicketId: odoo.ticketId,
          } as Prisma.InputJsonObject,
        },
      });
    }

    return { odooRef, created: true };
  } catch (error) {
    console.error(
      `[${params.logContext ?? "waraOdoo"}] No se pudo crear caso Odoo: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return { odooRef: null, created: false };
  }
}
