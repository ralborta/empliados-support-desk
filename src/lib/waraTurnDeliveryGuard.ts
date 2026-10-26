import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import { findCustomerByWhatsAppNumber, normalizeWhatsAppPhone } from "@/lib/whatsappPhone";

/** Teléfonos de clientes reales: no enviar WA por API manual / smoke sin inbound wamid. */
function protectedPhoneSet(): Set<string> {
  const raw = process.env.WARA_PROTECTED_CLIENT_PHONES?.trim();
  if (!raw) return new Set();
  return new Set(
    raw
      .split(/[,;\s]+/)
      .map((p) => normalizeWhatsAppPhone(p))
      .filter(Boolean),
  );
}

export function isProtectedClientPhone(rawPhone: string): boolean {
  const norm = normalizeWhatsAppPhone(rawPhone);
  if (!norm) return false;
  return protectedPhoneSet().has(norm);
}

function isWhatsAppInboundId(id: string | undefined | null): boolean {
  const v = String(id ?? "").trim();
  if (!/^wamid\./i.test(v)) return false;
  return true;
}

function isSimulatedTurnMessageId(id: string | undefined | null): boolean {
  const v = String(id ?? "").trim().toLowerCase();
  if (!v) return false;
  return /^(wa-|test-|probe-|smoke-|dry-)/.test(v);
}

/**
 * Cliente protegido: solo entregar si el mensaje entró por WhatsApp real (wamid en panel)
 * o el turn trae wamid. Bloquea smoke/API manual que solo persisten inbound sin webhook.
 */
export async function shouldDeliverWhatsAppToProtectedClient(
  rawPhone: string,
  selectionText: string,
  opts?: { messageId?: string; client?: PrismaClient },
): Promise<boolean> {
  if (!isProtectedClientPhone(rawPhone)) return true;

  const messageId = opts?.messageId?.trim();
  if (messageId && isSimulatedTurnMessageId(messageId)) {
    console.log("[waraTurnDeliveryGuard] blocked simulated messageId", rawPhone, messageId);
    return false;
  }
  if (messageId && isWhatsAppInboundId(messageId)) return true;

  const text = String(selectionText ?? "").trim();
  if (!text) return false;

  const client = opts?.client ?? prisma;
  const customer = await findCustomerByWhatsAppNumber(client, rawPhone);
  if (!customer) return false;

  const since = new Date(Date.now() - 3 * 60 * 1000);
  const inboundWithWamid = await client.ticketMessage.findFirst({
    where: {
      ticket: { customerId: customer.id },
      direction: "INBOUND",
      from: "CUSTOMER",
      text,
      createdAt: { gte: since },
      OR: [
        { externalMessageId: { startsWith: "wamid.", mode: "insensitive" } },
        { externalMessageId: { startsWith: "v3-in-", mode: "insensitive" } },
      ],
    },
    orderBy: { createdAt: "desc" },
  });
  if (inboundWithWamid) return true;

  // BBC a veces no pasa wamid en messageId del turn; /turn ya persistió el inbound del cliente.
  const inboundPersisted = await client.ticketMessage.findFirst({
    where: {
      ticket: { customerId: customer.id },
      direction: "INBOUND",
      from: "CUSTOMER",
      text,
      createdAt: { gte: since },
    },
    orderBy: { createdAt: "desc" },
  });
  if (inboundPersisted) return true;

  console.log("[waraTurnDeliveryGuard] blocked protected phone without inbound match", rawPhone);
  return false;
}
