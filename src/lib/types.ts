// Tipos compartidos que pueden usarse en cliente y servidor
export type MessageDirection = "INBOUND" | "OUTBOUND" | "INTERNAL_NOTE";
export type MessageFrom = "CUSTOMER" | "BOT" | "HUMAN";
export type TicketStatus = "OPEN" | "IN_PROGRESS" | "WAITING_CUSTOMER" | "RESOLVED" | "CLOSED";
export type TicketPriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";
export type TicketCategory = "TECH_SUPPORT" | "BILLING" | "SALES" | "OTHER";
export type TicketChannel = "WHATSAPP" | "EMAIL" | "WEB";
export type ResolutionMode =
  | "CHAT_RESOLVED"
  | "PENDING_VALIDATION"
  | "BACKOFFICE_DERIVED"
  | "TECH_ESCALATED"
  | "CLOSED_NO_ACTION";

export const resolutionModeLabels: Record<ResolutionMode, string> = {
  CHAT_RESOLVED: "Resuelto en chat",
  PENDING_VALIDATION: "Pendiente de validación",
  BACKOFFICE_DERIVED: "Derivado a backoffice",
  TECH_ESCALATED: "Escalado técnico",
  CLOSED_NO_ACTION: "Cerrado sin acción",
};

