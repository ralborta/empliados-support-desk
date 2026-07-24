import type { TicketStatus } from "@/lib/types";

const TERMINAL_STATUSES: TicketStatus[] = ["RESOLVED", "CLOSED"];

/**
 * Tras un mensaje saliente (bot o agente), el ticket pasa a "Esperando cliente"
 * salvo que ya esté cerrado/resuelto — no reabrir el hilo por un ack automático.
 */
export function statusAfterOutboundMessage(current: TicketStatus): TicketStatus {
  if (TERMINAL_STATUSES.includes(current)) return current;
  return "WAITING_CUSTOMER";
}
