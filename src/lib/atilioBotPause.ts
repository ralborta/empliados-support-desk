import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  bumpChannelSyncGenerationAtomic,
  isChannelSyncedForTarget,
  scheduleChannelSyncJob,
  type BotChannelSyncStatus,
  type BotChannelSyncTarget,
} from "@/lib/botChannelSync";
import { OPEN_TICKET_THREAD_STATUSES } from "@/lib/ticketThreading";
import { findCustomerByWhatsAppNumber } from "@/lib/whatsappPhone";

export const TERMINAL_TICKET_STATUSES = ["RESOLVED", "CLOSED"] as const;

/** Reactivación explícita desde el botón «Reactivar Kira». */
export const EXPLICIT_KIRA_REACTIVATE_REASON = "panel:bot-paused-toggle";

/**
 * Reactivación por resolución/cierre cuando la pausa fue automática (takeover).
 * Contrato 2026-10-07: resolve/close puede reactivar solo pausas `auto`.
 */
export const RESOLVE_AUTO_REACTIVATE_REASON = "resolve:auto-pause";

export type BotPausedSource = "auto" | "manual";

export type AtilioChannelSyncResult = {
  registered: boolean;
  channelSyncOk: boolean;
  muteOk: boolean;
  blacklistOk: boolean;
  syncStatus: BotChannelSyncStatus;
  syncTarget: BotChannelSyncTarget | null;
  syncGeneration: number;
  localPaused: boolean;
  pauseSource: BotPausedSource | null;
};

export type AtilioPauseOptions = {
  awaitChannelSync?: boolean;
  skipChannelIfAlreadyPaused?: boolean;
  forceChannelSync?: boolean;
  /** Default según reason: botón → manual; resto → auto. */
  pauseSource?: BotPausedSource;
};

export function isTerminalTicketStatus(status: string): boolean {
  return (TERMINAL_TICKET_STATUSES as readonly string[]).includes(status);
}

export function isExplicitKiraReactivateReason(reason: string | undefined | null): boolean {
  return String(reason ?? "").trim() === EXPLICIT_KIRA_REACTIVATE_REASON;
}

export function isAllowedKiraReactivateReason(reason: string | undefined | null): boolean {
  const r = String(reason ?? "").trim();
  return r === EXPLICIT_KIRA_REACTIVATE_REASON || r === RESOLVE_AUTO_REACTIVATE_REASON;
}

export function pauseSourceFromReason(reason: string | undefined | null): BotPausedSource {
  return String(reason ?? "").trim() === EXPLICIT_KIRA_REACTIVATE_REASON ? "manual" : "auto";
}

/** Nunca degradar manual → auto. */
export function mergePauseSource(
  current: string | null | undefined,
  requested: BotPausedSource,
): BotPausedSource {
  if (current === "manual") return "manual";
  return requested;
}

function asSyncStatus(raw: string | null | undefined): BotChannelSyncStatus {
  if (raw === "pending" || raw === "synced" || raw === "error" || raw === "idle") return raw;
  return "idle";
}

function asPauseSource(raw: string | null | undefined): BotPausedSource | null {
  if (raw === "auto" || raw === "manual") return raw;
  return null;
}

function humanControlFromRow(row: {
  botPausedAt: Date | null;
  botPausedSource?: string | null;
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
    pauseSource: asPauseSource(row.botPausedSource),
  };
}

async function bumpAndSchedule(
  client: PrismaClient,
  customerId: string,
  target: BotChannelSyncTarget,
  opts: { awaitChannelSync: boolean },
): Promise<AtilioChannelSyncResult> {
  const t0 = Date.now();
  // Generation+target atómicos: dos requests no pueden leer el mismo N.
  const updated = await bumpChannelSyncGenerationAtomic(client, customerId, target);
  if (!updated) {
    return {
      registered: false,
      channelSyncOk: false,
      muteOk: false,
      blacklistOk: false,
      syncStatus: "idle",
      syncTarget: null,
      syncGeneration: 0,
      localPaused: false,
      pauseSource: null,
    };
  }

  const generation = updated.botChannelSyncGeneration;
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
        botPausedSource: true,
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
 * Pausa Atilio/Kira: botPausedAt + source (auto|manual) + sync canal.
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
  const requestedSource = opts?.pauseSource ?? pauseSourceFromReason(reason);

  const customer = await client.customer.findUnique({
    where: { id: customerId },
    select: {
      id: true,
      phone: true,
      botPausedAt: true,
      botPausedSource: true,
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
      pauseSource: null,
    };
  }

  const nextSource = mergePauseSource(customer.botPausedSource, requestedSource);
  const alreadyPaused = Boolean(customer.botPausedAt);

  await client.customer.update({
    where: { id: customerId },
    data: {
      botPausedAt: customer.botPausedAt ?? new Date(),
      botPausedSource: nextSource,
    },
  });

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
        `[atilio] Pausado (ya synced) source=${nextSource} customer=${customerId}${reason ? ` (${reason})` : ""}`,
      );
      return humanControlFromRow({
        botPausedAt: customer.botPausedAt ?? new Date(),
        botPausedSource: nextSource,
        botChannelSyncStatus: "synced",
        botChannelSyncTarget: "paused",
        botChannelSyncGeneration: customer.botChannelSyncGeneration,
      });
    }
    if (pendingPaused) {
      console.log(
        `[atilio] Pausado local source=${nextSource}; sync pending gen=${customer.botChannelSyncGeneration} customer=${customerId}`,
      );
      return humanControlFromRow({
        botPausedAt: customer.botPausedAt ?? new Date(),
        botPausedSource: nextSource,
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
      pauseSource: nextSource,
    };
  }

  const result = await bumpAndSchedule(client, customerId, "paused", { awaitChannelSync });
  console.log(
    `[atilio] Pausado local source=${nextSource} customer=${customerId}${reason ? ` (${reason})` : ""} syncStatus=${result.syncStatus} gen=${result.syncGeneration}`,
  );
  return { ...result, localPaused: true, pauseSource: nextSource };
}

export async function isBotPausedForPhone(
  rawPhone: string,
  client: PrismaClient = prisma,
): Promise<boolean> {
  const customer = await findCustomerByWhatsAppNumber(client, rawPhone);
  return Boolean(customer?.botPausedAt);
}

/**
 * Reactiva Kira: limpia botPausedAt/source + sync canal.
 * Razones permitidas: botón «Reactivar Kira» o resolve:auto-pause.
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
  if (!isAllowedKiraReactivateReason(reason)) {
    console.warn(
      `[atilio] Reactivación bloqueada: reason="${reason ?? ""}" no autorizada`,
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
      pauseSource: null,
    };
  }

  const awaitChannelSync = opts?.awaitChannelSync !== false;

  const customer = await client.customer.findUnique({
    where: { id: customerId },
    select: {
      id: true,
      phone: true,
      botPausedAt: true,
      botPausedSource: true,
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
      pauseSource: null,
    };
  }

  const localWasPaused = !!customer.botPausedAt;
  if (localWasPaused || customer.botPausedSource) {
    await client.customer.update({
      where: { id: customerId },
      data: { botPausedAt: null, botPausedSource: null },
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
      pauseSource: null,
    };
  }

  const result = await bumpAndSchedule(client, customerId, "active", { awaitChannelSync });
  console.log(
    `[atilio] Reactivado local customer=${customerId} (${reason}) localWasPaused=${localWasPaused} syncStatus=${result.syncStatus} gen=${result.syncGeneration}`,
  );
  return { ...result, localPaused: false, pauseSource: null };
}

/**
 * Tras Resolver/Cerrar: reactiva solo si la pausa es `auto` y no quedan
 * tickets abiertos del mismo cliente. Pausa `manual` queda hasta el botón.
 * No envía mensaje espontáneo — solo limpia control + sync canal.
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

  const customer = await client.customer.findUnique({
    where: { id: customerId },
    select: {
      id: true,
      botPausedAt: true,
      botPausedSource: true,
    },
  });
  if (!customer?.botPausedAt) {
    console.log(
      `[atilio] Cierre ${ticketId} (${previousStatus}→${newStatus}) sin pausa activa` +
        `${reason ? ` [${reason}]` : ""}`,
    );
    return false;
  }

  const source = asPauseSource(customer.botPausedSource) ?? "auto";
  if (source === "manual") {
    console.log(
      `[atilio] Cierre ${ticketId} NO reactiva: pausa manual` +
        `${reason ? ` [${reason}]` : ""} — solo «Reactivar Kira»`,
    );
    return false;
  }

  const otherOpen = await client.ticket.count({
    where: {
      customerId,
      id: { not: ticketId },
      status: { in: OPEN_TICKET_THREAD_STATUSES },
    },
  });
  if (otherOpen > 0) {
    console.log(
      `[atilio] Cierre ${ticketId} NO reactiva: quedan ${otherOpen} ticket(s) abierto(s)` +
        `${reason ? ` [${reason}]` : ""}`,
    );
    return false;
  }

  const detail = await reactivateAtilioForCustomerDetailed(
    customerId,
    client,
    RESOLVE_AUTO_REACTIVATE_REASON,
    { awaitChannelSync: false },
  );
  console.log(
    `[atilio] Cierre ${ticketId} (${previousStatus}→${newStatus}) reactiva pausa auto` +
      `${reason ? ` [${reason}]` : ""} syncStatus=${detail.syncStatus}`,
  );
  return detail.registered;
}
