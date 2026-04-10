type TicketStatus = "OPEN" | "IN_PROGRESS" | "WAITING_CUSTOMER" | "RESOLVED" | "CLOSED";
type TicketPriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";
type TicketCategory = "TECH_SUPPORT" | "BILLING" | "SALES" | "OTHER";
type TicketChannel = "WHATSAPP" | "EMAIL" | "WEB";
type MessageDirection = "INBOUND" | "OUTBOUND" | "INTERNAL_NOTE";
type MessageFrom = "CUSTOMER" | "BOT" | "HUMAN";

export function generateTicketCode(date = new Date()) {
  const year = date.getFullYear();
  const stamp = `${date.getMonth() + 1}`.padStart(2, "0") + `${date.getDate()}`.padStart(2, "0");
  const suffix = Math.random().toString().slice(2, 8);
  return `TCK-${year}-${stamp}-${suffix}`;
}

export const statusLabels: Record<TicketStatus, string> = {
  OPEN: "Nuevo",
  IN_PROGRESS: "En análisis",
  WAITING_CUSTOMER: "Esperando datos del cliente",
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
