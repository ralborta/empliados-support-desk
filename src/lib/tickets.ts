import {
  TicketPriority,
  TicketStatus,
  TicketCategory,
  TicketChannel,
  MessageDirection,
  MessageFrom,
} from "@/generated/prisma";

export function generateTicketCode(date = new Date()) {
  const year = date.getFullYear();
  const stamp = `${date.getMonth() + 1}`.padStart(2, "0") + `${date.getDate()}`.padStart(2, "0");
  const suffix = Math.random().toString().slice(2, 8);
  return `TCK-${year}-${stamp}-${suffix}`;
}

export const statusLabels: Record<TicketStatus, string> = {
  OPEN: "Abierto",
  IN_PROGRESS: "En Progreso",
  WAITING_CUSTOMER: "Esperando Cliente",
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
  TECH_SUPPORT: "Soporte Técnico",
  BILLING: "Facturación",
  SALES: "Ventas",
  OTHER: "Otro",
};

export const channelLabels: Record<TicketChannel, string> = {
  WHATSAPP: "WhatsApp",
  EMAIL: "Email",
  WEB: "Web",
};

export const directionLabels: Record<MessageDirection, string> = {
  INBOUND: "Cliente",
  OUTBOUND: "Bot/Agente",
  INTERNAL_NOTE: "Nota Interna",
};

export const fromLabels: Record<MessageFrom, string> = {
  CUSTOMER: "Cliente",
  BOT: "Bot",
  HUMAN: "Agente",
};
