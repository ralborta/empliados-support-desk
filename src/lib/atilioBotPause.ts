import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  isChannelSyncedForTarget,
  scheduleChannelSyncJob,
  type BotChannelSyncStatus,
  type BotChannelSyncTarget,
} from "@/lib/botChannelSync";
import { findCustomerByWhatsAppNumber } from "@/lib/whatsappPhone";

export const TERMINAL_TICKET_STATUSES = ["RESOLVED", "CLOSED"] as const;

/** Única razón autorizada para levantar botPausedAt (botón «Reactivar Kira»). */
export const EXPLICIT_KIRA_REACTIVATE_REASON = "panel:bot-paused-toggle";

export type AtilioChannelSyncResult = {
  /** Control humano local registrado (botPausedAt). */
  registered: boolean;
  /** mute + blacklist Cloud OK (solo true si status=synced). */
  channelSyncOk: boolean;
  muteOk: boolean;
  blacklistOk: boolean;
  /** Estado real del sync con BuilderBot. */
  syncStatus: BotChannelSyncStatus;
  syncTarget: BotChannelSyncTarget | null;
  syncGeneration: number;
  /** true si el control local (botPausedAt) quedó aplicado. */
  localPaused: boolean;
};

export type AtilioPauseOptions = {
  /**
   * Si false: escribe botPausedAt y agenda sync post-respuesta (`after()`).
   * Default true (espera el job en el mismo request — útil en tests).
   */
  awaitChannelSync?: boolean;
  /**
   * Si ya estaba pausado y el canal ya está synced→paused, no re-agenda.
   * Si está pending/error, reintenta.
   */
  skipChannelIfAlreadyPaused?: boolean;
  /** Fuerza un nuevo generation + sync aunque ya esté synced. */
  forceChannelSync?: boolean;
};

export function isTerminalTicketStatus(status: string): boolean {
  return (TERMINAL_TICKET_STATUSES as readonly string[]).includes(status);
}

export function isExplicitKiraReactivateReason(reason: string | undefined | null): boolean {
  return String(reason ?? "").trim() === EXPLICIT_KIRA_REACTIVATE_REASON;
}

function asSyncStatus(raw: string | null | undefined): BotChannelSyncStatus {
  if (raw === "pending" || raw === "synced" || raw === "error" || raw === "idle") return raw;
  return "idle";
}

function humanControlFromRow(row: {
  botPausedAt: Date | null;
  botChannelSyncStatus: string;
  botChannelSyncTarget: string | null;
  botChannelSyncGeneration: number;
}): AtilioChannelSyncResult {
  const syncStatus = asSyncStatus(row.botChannelSyncStatus);
  const syncTarget = (row.botChannelSyncTarget as BotChannelSyncTarget | null) ?? null;
  const channelSyncOk = syncStatus === "synced";
  return {
    registered: true,
    channelSyncOk,
    muteOk: channelSyncOk,
    blacklistOk: channelSyncOk,
    syncStatus,
    syncTarget,
    syncGeneration: row.botChannelSyncGeneration,
    localPaused: Boolean(row.botPausedAt),
  };
}

async function bumpAndSchedule(
  client: PrismaClient,
  customerId: string,
  target: BotChannelSyncTarget,
  opts: { awaitChannelSync: boolean },
): Promise<AtilioChannelSyncResult> {
  const t0 = Date.now();
  const current = await client.customer.findUnique({
    where: { id: customerId },
    select: { botChannelSyncGeneration: true, botPausedAt: true },
  });
  if (!current) {
    return {
      registered: false,
      channelSyncOk: false,
      muteOk: false,
      blacklistOk: false,
      syncStatus: "idle",
      syncTarget: null,
      syncGeneration: 0,
      localPaused: false,
    };
  }

  const generation = (current.botChannelSyncGeneration ?? 0) + 1;
  const updated = await client.customer.update({
    where: { id: customerId },
    data: {
      botChannelSyncGeneration: generation,
      botChannelSyncTarget: target,
      botChannelSyncStatus: "pending",
      botChannelSyncError: null,
      botChannelSyncAttempts: 0,
      botChannelSyncAt: null,
    },
    select: {
      botPausedAt: true,
      botChannelSyncStatus: true,
      botChannelSyncTarget: true,
      botChannelSyncGeneration: true,
    },
  });
  console.log(
    `[atilio] sync scheduled target=${target} gen=${generation} customer=${customerId} dbMs=${Date.now() - t0}`,
  );

  if (opts.awaitChannelSync) {
    const { runChannelSyncJob } = await import("@/lib/botChannelSync");
    await runChannelSyncJob({ customerId, generation, target, client });
    const fresh = await client.customer.findUniqueOrThrow({
      where: { id: customerId },
      select: {
        botPausedAt: true,
        botChannelSyncStatus: true,
        botChannelSyncTarget: true,
        botChannelSyncGeneration: true,
      },
    });
    return humanControlFromRow(fresh);
  }

  scheduleChannelSyncJob({ customerId, generation, target });
  return humanControlFromRow(updated);
}

/**
 * Pausa Atilio/Kira: botPausedAt local + sync canal (generation + after()).
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
  const force = opts?.forceChannelSync === true;

  const customer = await client.customer.findUnique({
    where: { id: customerId },
    select: {
      id: true,
      phone: true,
      botPausedAt: true,
      botChannelSyncStatus: true,
      botChannelSyncTarget: true,
      botChannelSyncGeneration: true,
    },
  });
  if (!customer) {
    return {
      registered: false,
      channelSyncOk: false,
      muteOk: false,
      blacklistOk: false,
      syncStatus: "idle",
      syncTarget: null,
      syncGeneration: 0,
      localPaused: false,
    };
  }

  const alreadyPaused = Boolean(customer.botPausedAt);
  if (!alreadyPaused) {
    await client.customer.update({
      where: { id: customerId },
      data: { botPausedAt: new Date() },
    });
  }

  const syncedPaused = isChannelSyncedForTarget(
    customer.botChannelSyncStatus,
    customer.botChannelSyncTarget,
    "paused",
  );
  const pendingPaused =
    customer.botChannelSyncStatus === "pending" && customer.botChannelSyncTarget === "paused";

  if (skipIfPaused && alreadyPaused && !force) {
    if (syncedPaused) {
      console.log(
        `[atilio] Pausado (ya synced) customer=${customerId}${reason ? ` (${reason})` : ""}`,
      );
      return humanControlFromRow({
        botPausedAt: customer.botPausedAt ?? new Date(),
        botChannelSyncStatus: "synced",
        botChannelSyncTarget: "paused",
        botChannelSyncGeneration: customer.botChannelSyncGeneration,
      });
    }
    if (pendingPaused) {
      console.log(
        `[atilio] Pausado local; sync ya pending gen=${customer.botChannelSyncGeneration} customer=${customerId}`,
      );
      return humanControlFromRow({
        botPausedAt: customer.botPausedAt ?? new Date(),
        botChannelSyncStatus: "pending",
        botChannelSyncTarget: "paused",
        botChannelSyncGeneration: customer.botChannelSyncGeneration,
      });
    }
  }

  if (!customer.phone) {
    await client.customer.update({
      where: { id: customerId },
      data: {
        botChannelSyncStatus: "synced",
        botChannelSyncTarget: "paused",
        botChannelSyncError: null,
        botChannelSyncAt: new Date(),
      },
    });
    return {
      registered: true,
      channelSyncOk: true,
      muteOk: true,
      blacklistOk: true,
      syncStatus: "synced",
      syncTarget: "paused",
      syncGeneration: customer.botChannelSyncGeneration,
      localPaused: true,
    };
  }

  const result = await bumpAndSchedule(client, customerId, "paused", { awaitChannelSync });
  console.log(
    `[atilio] Pausado local customer=${customerId}${reason ? ` (${reason})` : ""} syncStatus=${result.syncStatus} gen=${result.syncGeneration}`,
  );
  return { ...result, localPaused: true };
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
 * Reactiva Kira: limpia botPausedAt + sync canal.
 * Contrato 2026-10-01: SOLO el botón «Reactivar Kira» (`panel:bot-paused-toggle`).
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
  opts?: { awaitChannelSync?: boolean; forceChannelSync?: boolean },
): Promise<AtilioChannelSyncResult> {
  if (!isExplicitKiraReactivateReason(reason)) {
    console.warn(
      `[atilio] Reactivación bloqueada: reason="${reason ?? ""}" no es ${EXPLICIT_KIRA_REACTIVATE_REASON}`,
      { customerId },
    );
    return {
      registered: false,
      channelSyncOk: false,
      muteOk: false,
      blacklistOk: false,
      syncStatus: "idle",
      syncTarget: null,
      syncGeneration: 0,
      localPaused: false,
    };
  }

  const awaitChannelSync = opts?.awaitChannelSync !== false;

  const customer = await client.customer.findUnique({
    where: { id: customerId },
    select: {
      id: true,
      phone: true,
      botPausedAt: true,
      botChannelSyncGeneration: true,
    },
  });
  if (!customer) {
    return {
      registered: false,
      channelSyncOk: false,
      muteOk: false,
      blacklistOk: false,
      syncStatus: "idle",
      syncTarget: null,
      syncGeneration: 0,
      localPaused: false,
    };
  }

  const localWasPaused = !!customer.botPausedAt;
  if (localWasPaused) {
    await client.customer.update({
      where: { id: customerId },
      data: { botPausedAt: null },
    });
  }

  if (!customer.phone) {
    await client.customer.update({
      where: { id: customerId },
      data: {
        botChannelSyncStatus: "synced",
        botChannelSyncTarget: "active",
        botChannelSyncError: null,
        botChannelSyncAt: new Date(),
      },
    });
    return {
      registered: true,
      channelSyncOk: true,
      muteOk: true,
      blacklistOk: true,
      syncStatus: "synced",
      syncTarget: "active",
      syncGeneration: customer.botChannelSyncGeneration,
      localPaused: false,
    };
  }

  const result = await bumpAndSchedule(client, customerId, "active", { awaitChannelSync });
  console.log(
    `[atilio] Reactivado local customer=${customerId} (${reason}) localWasPaused=${localWasPaused} syncStatus=${result.syncStatus} gen=${result.syncGeneration}`,
  );
  return { ...result, localPaused: false };
}

/**
 * @deprecated Contrato 2026-10-01: cerrar/resolver NO reactiva Kira.
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
