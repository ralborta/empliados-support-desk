import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  ensureBuilderBotContactActive,
  setBotBlacklist,
  setBuilderBotCloudBlacklist,
  setBuilderBotContactMute,
} from "@/lib/builderbot";
import { OPEN_TICKET_THREAD_STATUSES } from "@/lib/ticketThreading";

export const TERMINAL_TICKET_STATUSES = ["RESOLVED", "CLOSED"] as const;

export function isTerminalTicketStatus(status: string): boolean {
  return (TERMINAL_TICKET_STATUSES as readonly string[]).includes(status);
}

/**
 * Pausa Atilio para un cliente: botPausedAt + mute=true + blacklist=add.
 * Idempotente: si ya estaba pausado en DB, igual reconcilia BuilderBot.
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

  let muteOk = true;
  let blacklistOk = true;
  if (customer.phone) {
    muteOk = await setBuilderBotContactMute(customer.phone, true);
    blacklistOk = await setBuilderBotCloudBlacklist(customer.phone, "add");
    await setBotBlacklist(customer.phone, "add").catch((err: unknown) => {
      console.error(
        "[atilio] Error al agregar blacklist self-hosted:",
        err instanceof Error ? err.message : err,
      );
    });
  }

  console.log(
    `[atilio] Pausado para cliente ${customerId}${reason ? ` (${reason})` : ""} muteOk=${muteOk} blacklistOk=${blacklistOk}`,
  );
  return muteOk && blacklistOk;
}

/**
 * Reactiva Atilio y reconcilia el canal remoto aunque `botPausedAt` ya sea null.
 * Tres estados: botPausedAt local, /mute y /blacklist en BuilderBot.
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
  if (!customer) return false;

  const localWasPaused = !!customer.botPausedAt;
  if (localWasPaused) {
    await client.customer.update({
      where: { id: customerId },
      data: { botPausedAt: null },
    });
  }

  let muteOk = true;
  let blacklistOk = true;
  if (customer.phone) {
    const channel = await ensureBuilderBotContactActive(customer.phone);
    muteOk = channel.muteOk;
    blacklistOk = channel.blacklistOk;
    await setBotBlacklist(customer.phone, "remove").catch((err: unknown) => {
      console.error(
        "[atilio] Error al quitar blacklist self-hosted:",
        err instanceof Error ? err.message : err,
      );
    });
  }

  console.log(
    `[atilio] Reactivado para cliente ${customerId}${reason ? ` (${reason})` : ""} localWasPaused=${localWasPaused} muteOk=${muteOk} blacklistOk=${blacklistOk}`,
  );
  return muteOk && blacklistOk;
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
