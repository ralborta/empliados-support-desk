import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import { setBuilderBotCloudBlacklist, setBotBlacklist } from "@/lib/builderbot";
import { OPEN_TICKET_THREAD_STATUSES } from "@/lib/ticketThreading";

export const TERMINAL_TICKET_STATUSES = ["RESOLVED", "CLOSED"] as const;

export function isTerminalTicketStatus(status: string): boolean {
  return (TERMINAL_TICKET_STATUSES as readonly string[]).includes(status);
}

/**
 * Pausa Atilio para un cliente (botPausedAt + blacklist BBC).
 * Idempotente: si ya estaba pausado, solo asegura blacklist.
 */
export async function pauseAtilioForCustomer(
  customerId: string,
  client: PrismaClient = prisma,
  reason?: string,
): Promise<boolean> {
  const customer = await client.customer.findUnique({
    where: { id: customerId },
    select: { id: true, phone: true, botPausedAt: true },
  });
  if (!customer) return false;

  if (!customer.botPausedAt) {
    await client.customer.update({
      where: { id: customerId },
      data: { botPausedAt: new Date() },
    });
  }

  if (customer.phone) {
    await setBuilderBotCloudBlacklist(customer.phone, "add").catch((err: unknown) => {
      console.error(
        "[atilio] Error al agregar blacklist Cloud:",
        err instanceof Error ? err.message : err,
      );
    });
    await setBotBlacklist(customer.phone, "add").catch((err: unknown) => {
      console.error(
        "[atilio] Error al agregar blacklist self-hosted:",
        err instanceof Error ? err.message : err,
      );
    });
  }

  console.log(`[atilio] Pausado para cliente ${customerId}${reason ? ` (${reason})` : ""}`);
  return true;
}

/**
 * Reactiva Atilio para un cliente (botPausedAt = null + sacar de blacklist BBC).
 * Idempotente: si ya estaba activo, no hace nada.
 */
export async function reactivateAtilioForCustomer(
  customerId: string,
  client: PrismaClient = prisma,
  reason?: string,
): Promise<boolean> {
  const customer = await client.customer.findUnique({
    where: { id: customerId },
    select: { id: true, phone: true, botPausedAt: true },
  });
  if (!customer?.botPausedAt) return false;

  await client.customer.update({
    where: { id: customerId },
    data: { botPausedAt: null },
  });

  if (customer.phone) {
    await setBuilderBotCloudBlacklist(customer.phone, "remove").catch((err: unknown) => {
      console.error(
        "[atilio] Error al quitar blacklist Cloud:",
        err instanceof Error ? err.message : err,
      );
    });
    await setBotBlacklist(customer.phone, "remove").catch((err: unknown) => {
      console.error(
        "[atilio] Error al quitar blacklist self-hosted:",
        err instanceof Error ? err.message : err,
      );
    });
  }

  console.log(`[atilio] Reactivado para cliente ${customerId}${reason ? ` (${reason})` : ""}`);
  return true;
}

/**
 * Tras cerrar/resolver un ticket, reactiva Atilio si no quedan otros tickets abiertos
 * para el mismo cliente. Así el cliente puede volver a escribir y Atilio responde.
 */
export async function reactivateAtilioAfterTicketClosed(
  params: {
    customerId: string | null | undefined;
    ticketId: string;
    previousStatus: string;
    newStatus: string;
    reason?: string;
  },
  client: PrismaClient = prisma,
): Promise<boolean> {
  const { customerId, ticketId, previousStatus, newStatus, reason } = params;
  if (!customerId) return false;
  if (!isTerminalTicketStatus(newStatus)) return false;
  if (isTerminalTicketStatus(previousStatus)) return false;

  const otherOpen = await client.ticket.count({
    where: {
      customerId,
      id: { not: ticketId },
      status: { in: OPEN_TICKET_THREAD_STATUSES },
    },
  });
  if (otherOpen > 0) {
    console.log(
      `[atilio] No reactivar cliente ${customerId}: ${otherOpen} ticket(s) abierto(s) además de ${ticketId}`,
    );
    return false;
  }

  return reactivateAtilioForCustomer(customerId, client, reason);
}
