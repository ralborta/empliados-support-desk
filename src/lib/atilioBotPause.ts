import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  ensureBuilderBotContactActive,
  ensureBuilderBotContactPaused,
  setBotBlacklist,
} from "@/lib/builderbot";
import { findCustomerByWhatsAppNumber } from "@/lib/whatsappPhone";

export const TERMINAL_TICKET_STATUSES = ["RESOLVED", "CLOSED"] as const;

/** Única razón autorizada para levantar botPausedAt (botón «Reactivar Kira»). */
export const EXPLICIT_KIRA_REACTIVATE_REASON = "panel:bot-paused-toggle";

export type AtilioChannelSyncResult = {
  /** Control humano local registrado (botPausedAt). */
  registered: boolean;
  /** mute + blacklist Cloud OK. */
  channelSyncOk: boolean;
  muteOk: boolean;
  blacklistOk: boolean;
};

export function isTerminalTicketStatus(status: string): boolean {
  return (TERMINAL_TICKET_STATUSES as readonly string[]).includes(status);
}

export function isExplicitKiraReactivateReason(reason: string | undefined | null): boolean {
  return String(reason ?? "").trim() === EXPLICIT_KIRA_REACTIVATE_REASON;
}

/**
 * Pausa Atilio/Kira: botPausedAt + mute=true + blacklist=add.
 * Idempotente: si ya estaba pausado en DB, igual reconcilia BuilderBot
 * (sirve para «reintentar sync» desde el panel).
 */
export async function pauseAtilioForCustomer(
  customerId: string,
  client: PrismaClient = prisma,
  reason?: string,
): Promise<boolean> {
  const detail = await pauseAtilioForCustomerDetailed(customerId, client, reason);
  return detail.channelSyncOk;
}

export async function pauseAtilioForCustomerDetailed(
  customerId: string,
  client: PrismaClient = prisma,
  reason?: string,
): Promise<AtilioChannelSyncResult> {
  const customer = await client.customer.findUnique({
    where: { id: customerId },
    select: { id: true, phone: true, botPausedAt: true },
  });
  if (!customer) {
    return { registered: false, channelSyncOk: false, muteOk: false, blacklistOk: false };
  }

  if (!customer.botPausedAt) {
    await client.customer.update({
      where: { id: customerId },
      data: { botPausedAt: new Date() },
    });
  }

  let muteOk = true;
  let blacklistOk = true;
  if (customer.phone) {
    const channel = await ensureBuilderBotContactPaused(customer.phone);
    muteOk = channel.muteOk;
    blacklistOk = channel.blacklistOk;
    await setBotBlacklist(customer.phone, "add").catch((err: unknown) => {
      console.error(
        "[atilio] Error al agregar blacklist self-hosted:",
        err instanceof Error ? err.message : err,
      );
    });
  }

  const channelSyncOk = muteOk && blacklistOk;
  console.log(
    `[atilio] Pausado para cliente ${customerId}${reason ? ` (${reason})` : ""} muteOk=${muteOk} blacklistOk=${blacklistOk}`,
  );
  return { registered: true, channelSyncOk, muteOk, blacklistOk };
}

/** ¿Kira está bajo control humano persistente para este teléfono? */
export async function isBotPausedForPhone(
  rawPhone: string,
  client: PrismaClient = prisma,
): Promise<boolean> {
  const customer = await findCustomerByWhatsAppNumber(client, rawPhone);
  return Boolean(customer?.botPausedAt);
}

/**
 * Reactiva Kira: limpia botPausedAt + mute/blacklist.
 * Contrato 2026-10-01: SOLO el botón «Reactivar Kira» (`panel:bot-paused-toggle`).
 * Cierre de ticket, derivaciones y handoffs NO deben llamar esto para levantar pausa.
 */
export async function reactivateAtilioForCustomer(
  customerId: string,
  client: PrismaClient = prisma,
  reason?: string,
): Promise<boolean> {
  const detail = await reactivateAtilioForCustomerDetailed(customerId, client, reason);
  return detail.channelSyncOk;
}

export async function reactivateAtilioForCustomerDetailed(
  customerId: string,
  client: PrismaClient = prisma,
  reason?: string,
): Promise<AtilioChannelSyncResult> {
  if (!isExplicitKiraReactivateReason(reason)) {
    console.warn(
      `[atilio] Reactivación bloqueada: reason="${reason ?? ""}" no es ${EXPLICIT_KIRA_REACTIVATE_REASON}`,
      { customerId },
    );
    return { registered: false, channelSyncOk: false, muteOk: false, blacklistOk: false };
  }

  const customer = await client.customer.findUnique({
    where: { id: customerId },
    select: { id: true, phone: true, botPausedAt: true },
  });
  if (!customer) {
    return { registered: false, channelSyncOk: false, muteOk: false, blacklistOk: false };
  }

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

  const channelSyncOk = muteOk && blacklistOk;
  console.log(
    `[atilio] Reactivado para cliente ${customerId} (${reason}) localWasPaused=${localWasPaused} muteOk=${muteOk} blacklistOk=${blacklistOk}`,
  );
  return { registered: true, channelSyncOk, muteOk, blacklistOk };
}

/**
 * @deprecated Contrato 2026-10-01: cerrar/resolver NO reactiva Kira.
 * Solo «Reactivar Kira». Se mantiene la firma para no romper call sites.
 */
export async function reactivateAtilioAfterTicketClosed(
  params: {
    customerId: string | null | undefined;
    ticketId: string;
    previousStatus: string;
    newStatus: string;
    reason?: string;
  },
  _client: PrismaClient = prisma,
): Promise<boolean> {
  const { customerId, ticketId, previousStatus, newStatus, reason } = params;
  if (!customerId) return false;
  if (!isTerminalTicketStatus(newStatus)) return false;
  if (isTerminalTicketStatus(previousStatus)) return false;
  console.log(
    `[atilio] Cierre ${ticketId} (${previousStatus}→${newStatus}) NO reactiva Kira` +
      `${reason ? ` [${reason}]` : ""} — solo «Reactivar Kira»`,
  );
  return false;
}
