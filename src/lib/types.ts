// Tipos compartidos que pueden usarse en cliente y servidor
export type MessageDirection = "INBOUND" | "OUTBOUND" | "INTERNAL_NOTE";
export type MessageFrom = "CUSTOMER" | "BOT" | "HUMAN";
export type TicketStatus = "OPEN" | "IN_PROGRESS" | "WAITING_CUSTOMER" | "RESOLVED" | "CLOSED";
export type TicketPriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";
export type TicketCategory = "TECH_SUPPORT" | "BILLING" | "SALES" | "OTHER";
export type TicketChannel = "WHATSAPP" | "EMAIL" | "WEB";

