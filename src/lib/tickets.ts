import type { Prisma, PrismaClient } from "@prisma/client";

type TicketStatus = "OPEN" | "IN_PROGRESS" | "WAITING_CUSTOMER" | "RESOLVED" | "CLOSED";
type TicketPriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";
type TicketCategory = "TECH_SUPPORT" | "BILLING" | "SALES" | "OTHER";
type TicketChannel = "WHATSAPP" | "EMAIL" | "WEB";
type MessageDirection = "INBOUND" | "OUTBOUND" | "INTERNAL_NOTE";
type MessageFrom = "CUSTOMER" | "BOT" | "HUMAN";

/** Zona horaria operativa Wara (Argentina). */
export const TICKET_CODE_TIMEZONE = "America/Argentina/Buenos_Aires";

type TicketCodeClient = PrismaClient | Prisma.TransactionClient;

/** Prefijo DDMMYY para la fecha en Argentina (ej. 250726). */
export function formatTicketDayKey(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TICKET_CODE_TIMEZONE,
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  }).formatToParts(date);

  const day = parts.find((p) => p.type === "day")?.value ?? "01";
  const month = parts.find((p) => p.type === "month")?.value ?? "01";
  const year = parts.find((p) => p.type === "year")?.value ?? "00";

  return `${day}${month}${year}`;
}

/**
 * Nomenclatura Wara: DDMMYY + correlativo diario (1, 2, 3…).
 * Ej. 25/07/2026 → 2507261, 2507262, 2507263
 */
export async function allocateTicketCode(
  client: TicketCodeClient,
  date = new Date(),
): Promise<string> {
  const dayKey = formatTicketDayKey(date);

  const row = await client.ticketDailySequence.upsert({
    where: { dayKey },
    create: { dayKey, lastSeq: 1 },
    update: { lastSeq: { increment: 1 } },
  });

  return `${dayKey}${row.lastSeq}`;
}

export const statusLabels: Record<TicketStatus, string> = {
  OPEN: "Nuevo",
  IN_PROGRESS: "En análisis",
  WAITING_CUSTOMER: "Esperando cliente",
  RESOLVED: "Resuelto",
  CLOSED: "Cerrado",
};

export const priorityLabels: Record<TicketPriority, string> = {
  LOW: "Baja",
  NORMAL: "Normal",
  HIGH: "Alta",
  URGENT: "Urgente",
};

export const categoryLabels: Record<TicketCategory, string> = {
  TECH_SUPPORT: "Consulta técnica general",
  BILLING: "Cambio de odómetro",
  SALES: "Emisión de certificado",
  OTHER: "Derivación administrativa",
};

export const channelLabels: Record<TicketChannel, string> = {
  WHATSAPP: "WhatsApp",
  EMAIL: "Email",
  WEB: "Web",
};

export const directionLabels: Record<MessageDirection, string> = {
  INBOUND: "Cliente",
  OUTBOUND: "Atilio / Agente",
  INTERNAL_NOTE: "Nota Interna",
};

export const fromLabels: Record<MessageFrom, string> = {
  CUSTOMER: "Cliente",
  BOT: "Atilio",
  HUMAN: "Agente",
};
