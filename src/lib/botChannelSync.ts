import { waitUntil } from "@vercel/functions";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  ensureBuilderBotContactActive,
  ensureBuilderBotContactPaused,
  setBotBlacklist,
} from "@/lib/builderbot";

export type BotChannelSyncStatus = "idle" | "pending" | "synced" | "error";
export type BotChannelSyncTarget = "paused" | "active";

export const CHANNEL_SYNC_MAX_ATTEMPTS = 3;
const CHANNEL_SYNC_RETRY_BASE_MS = 600;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Agenda trabajo post-respuesta sin bloquear el handler.
 * Usa waitUntil (mismo primitive que after() de Next en este runtime).
 * Fuera de request context el promise igual corre en background.
 */
export function scheduleAfterResponse(task: () => Promise<void>): void {
  const promise = task().catch((err: unknown) => {
    console.error(
      "[botChannelSync] bg task failed:",
      err instanceof Error ? err.message : err,
    );
  });
  try {
    waitUntil(promise);
  } catch {
    /* ya está en vuelo */
  }
}

async function applyCloudTarget(
  phone: string,
  target: BotChannelSyncTarget,
): Promise<{ muteOk: boolean; blacklistOk: boolean; ok: boolean; ms: number }> {
  const t0 = Date.now();
  const channel =
    target === "paused"
      ? await ensureBuilderBotContactPaused(phone)
      : await ensureBuilderBotContactActive(phone);
  void setBotBlacklist(phone, target === "paused" ? "add" : "remove").catch((err: unknown) => {
    console.error(
      "[botChannelSync] self-hosted blacklist:",
      err instanceof Error ? err.message : err,
    );
  });
  return {
    muteOk: channel.muteOk,
    blacklistOk: channel.blacklistOk,
    ok: channel.muteOk && channel.blacklistOk,
    ms: Date.now() - t0,
  };
}

/**
 * Ejecuta mute/blacklist para una generation concreta.
 * Si el asesor cambió de opinión (nueva generation), aborta sin pisar estado.
 */
export async function runChannelSyncJob(params: {
  customerId: string;
  generation: number;
  target: BotChannelSyncTarget;
  client?: PrismaClient;
}): Promise<void> {
  const client = params.client ?? prisma;
  const { customerId, generation, target } = params;

  for (let attempt = 1; attempt <= CHANNEL_SYNC_MAX_ATTEMPTS; attempt++) {
    const row = await client.customer.findUnique({
      where: { id: customerId },
      select: {
        phone: true,
        botChannelSyncGeneration: true,
        botChannelSyncTarget: true,
      },
    });
    if (!row) return;
    if (row.botChannelSyncGeneration !== generation) {
      console.log(
        `[botChannelSync] abort superseded gen=${generation} current=${row.botChannelSyncGeneration} customer=${customerId}`,
      );
      return;
    }
    if (row.botChannelSyncTarget !== target) {
      console.log(
        `[botChannelSync] abort target mismatch want=${target} have=${row.botChannelSyncTarget} customer=${customerId}`,
      );
      return;
    }
    if (!row.phone) {
      await client.customer.updateMany({
        where: { id: customerId, botChannelSyncGeneration: generation },
        data: {
          botChannelSyncStatus: "synced",
          botChannelSyncAt: new Date(),
          botChannelSyncError: null,
          botChannelSyncAttempts: attempt,
        },
      });
      return;
    }

    await client.customer.updateMany({
      where: { id: customerId, botChannelSyncGeneration: generation },
      data: { botChannelSyncAttempts: attempt, botChannelSyncStatus: "pending" },
    });

    const result = await applyCloudTarget(row.phone, target);
    console.log(
      `[botChannelSync] attempt=${attempt}/${CHANNEL_SYNC_MAX_ATTEMPTS} target=${target} customer=${customerId} gen=${generation} ok=${result.ok} bbcMs=${result.ms} muteOk=${result.muteOk} blacklistOk=${result.blacklistOk}`,
    );

    // Releer generation antes de persistir resultado.
    const still = await client.customer.findUnique({
      where: { id: customerId },
      select: { botChannelSyncGeneration: true, botChannelSyncTarget: true },
    });
    if (
      !still ||
      still.botChannelSyncGeneration !== generation ||
      still.botChannelSyncTarget !== target
    ) {
      console.log(
        `[botChannelSync] discard stale result gen=${generation} customer=${customerId}`,
      );
      return;
    }

    if (result.ok) {
      await client.customer.updateMany({
        where: { id: customerId, botChannelSyncGeneration: generation },
        data: {
          botChannelSyncStatus: "synced",
          botChannelSyncAt: new Date(),
          botChannelSyncError: null,
          botChannelSyncAttempts: attempt,
        },
      });
      return;
    }

    if (attempt < CHANNEL_SYNC_MAX_ATTEMPTS) {
      await sleep(CHANNEL_SYNC_RETRY_BASE_MS * attempt);
      continue;
    }

    await client.customer.updateMany({
      where: { id: customerId, botChannelSyncGeneration: generation },
      data: {
        botChannelSyncStatus: "error",
        botChannelSyncAt: new Date(),
        botChannelSyncError: `muteOk=${result.muteOk} blacklistOk=${result.blacklistOk}`,
        botChannelSyncAttempts: attempt,
      },
    });
  }
}

export function scheduleChannelSyncJob(params: {
  customerId: string;
  generation: number;
  target: BotChannelSyncTarget;
}): void {
  scheduleAfterResponse(() =>
    runChannelSyncJob({
      customerId: params.customerId,
      generation: params.generation,
      target: params.target,
    }),
  );
}

export function isChannelSyncedForTarget(
  status: string | null | undefined,
  target: string | null | undefined,
  desired: BotChannelSyncTarget,
): boolean {
  return status === "synced" && target === desired;
}
