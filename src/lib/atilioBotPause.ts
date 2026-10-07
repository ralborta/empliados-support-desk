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

export type AtilioPauseOptions = {
  /**
   * Si false: escribe botPausedAt y dispara mute/blacklist en background.
   * El envío humano del panel no debe esperar a BuilderBot.
   * Default true.
   */
  awaitChannelSync?: boolean;
  /**
   * Si ya estaba pausado, no vuelve a pegarle a Cloud (cada mensaje humano
   * re-sincronizaba mute+blacklist y dejaba el panel en «ENVIANDO…»).
   */
  skipChannelIfAlreadyPaused?: boolean;
};

export function isTerminalTicketStatus(status: string): boolean {
  return (TERMINAL_TICKET_STATUSES as readonly string[]).includes(status);
}

export function isExplicitKiraReactivateReason(reason: string | undefined | null): boolean {
  return String(reason ?? "").trim() === EXPLICIT_KIRA_REACTIVATE_REASON;
}

async function syncPauseChannel(
  phone: string,
): Promise<Pick<AtilioChannelSyncResult, "muteOk" | "blacklistOk" | "channelSyncOk">> {
  const channel = await ensureBuilderBotContactPaused(phone);
  // Self-hosted es best-effort; no alarga el camino crítico del panel.
  void setBotBlacklist(phone, "add").catch((err: unknown) => {
    console.error(
      "[atilio] Error al agregar blacklist self-hosted:",
      err instanceof Error ? err.message : err,
    );
  });
  return {
    muteOk: channel.muteOk,
    blacklistOk: channel.blacklistOk,
    channelSyncOk: channel.muteOk && channel.blacklistOk,
  };
}

async function syncActiveChannel(
  phone: string,
): Promise<Pick<AtilioChannelSyncResult, "muteOk" | "blacklistOk" | "channelSyncOk">> {
  const channel = await ensureBuilderBotContactActive(phone);
  void setBotBlacklist(phone, "remove").catch((err: unknown) => {
    console.error(
      "[atilio] Error al quitar blacklist self-hosted:",
      err instanceof Error ? err.message : err,
    );
  });
  return {
    muteOk: channel.muteOk,
    blacklistOk: channel.blacklistOk,
    channelSyncOk: channel.muteOk && channel.blacklistOk,
  };
}

/**
 * Pausa Atilio/Kira: botPausedAt + mute=true + blacklist=add.
 * Idempotente: si ya estaba pausado en DB, igual reconcilia BuilderBot
 * (sirve para «reintentar sync» desde el panel), salvo skipChannelIfAlreadyPaused.
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
  opts?: AtilioPauseOptions,
): Promise<AtilioChannelSyncResult> {
  const awaitChannelSync = opts?.awaitChannelSync !== false;
  const skipIfPaused = opts?.skipChannelIfAlreadyPaused === true;

  const customer = await client.customer.findUnique({
    where: { id: customerId },
    select: { id: true, phone: true, botPausedAt: true },
  });
  if (!customer) {
    return { registered: false, channelSyncOk: false, muteOk: false, blacklistOk: false };
  }

  const alreadyPaused = Boolean(customer.botPausedAt);
  if (!alreadyPaused) {
    await client.customer.update({
      where: { id: customerId },
      data: { botPausedAt: new Date() },
    });
  }

  if (skipIfPaused && alreadyPaused) {
    console.log(
      `[atilio] Pausado (ya activo) para cliente ${customerId}${reason ? ` (${reason})` : ""} — skip canal`,
    );
    return { registered: true, channelSyncOk: true, muteOk: true, blacklistOk: true };
  }

  if (!customer.phone) {
    return { registered: true, channelSyncOk: true, muteOk: true, blacklistOk: true };
  }

  if (!awaitChannelSync) {
    void syncPauseChannel(customer.phone)
      .then((r) => {
        console.log(
          `[atilio] Sync canal (bg) pause ${customerId} muteOk=${r.muteOk} blacklistOk=${r.blacklistOk}`,
        );
      })
      .catch((err: unknown) => {
        console.error(
          "[atilio] Sync canal (bg) pause falló:",
          err instanceof Error ? err.message : err,
        );
      });
    console.log(
      `[atilio] Pausado local para cliente ${customerId}${reason ? ` (${reason})` : ""} — canal en background`,
    );
    return { registered: true, channelSyncOk: false, muteOk: false, blacklistOk: false };
  }

  const channel = await syncPauseChannel(customer.phone);
  console.log(
    `[atilio] Pausado para cliente ${customerId}${reason ? ` (${reason})` : ""} muteOk=${channel.muteOk} blacklistOk=${channel.blacklistOk}`,
  );
  return { registered: true, ...channel };
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
  opts?: { awaitChannelSync?: boolean },
): Promise<AtilioChannelSyncResult> {
  if (!isExplicitKiraReactivateReason(reason)) {
    console.warn(
      `[atilio] Reactivación bloqueada: reason="${reason ?? ""}" no es ${EXPLICIT_KIRA_REACTIVATE_REASON}`,
      { customerId },
    );
    return { registered: false, channelSyncOk: false, muteOk: false, blacklistOk: false };
  }

  const awaitChannelSync = opts?.awaitChannelSync !== false;

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

  if (!customer.phone) {
    return { registered: true, channelSyncOk: true, muteOk: true, blacklistOk: true };
  }

  if (!awaitChannelSync) {
    void syncActiveChannel(customer.phone)
      .then((r) => {
        console.log(
          `[atilio] Sync canal (bg) reactivate ${customerId} muteOk=${r.muteOk} blacklistOk=${r.blacklistOk}`,
        );
      })
      .catch((err: unknown) => {
        console.error(
          "[atilio] Sync canal (bg) reactivate falló:",
          err instanceof Error ? err.message : err,
        );
      });
    console.log(
      `[atilio] Reactivado local para cliente ${customerId} (${reason}) localWasPaused=${localWasPaused} — canal en background`,
    );
    return { registered: true, channelSyncOk: false, muteOk: false, blacklistOk: false };
  }

  const channel = await syncActiveChannel(customer.phone);
  console.log(
    `[atilio] Reactivado para cliente ${customerId} (${reason}) localWasPaused=${localWasPaused} muteOk=${channel.muteOk} blacklistOk=${channel.blacklistOk}`,
  );
  return { registered: true, ...channel };
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
