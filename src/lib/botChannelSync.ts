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

/** Una cola por cliente: evita que un mute viejo pise un unmute más nuevo en BBC. */
const customerSyncChains = new Map<string, Promise<void>>();

export function enqueueCustomerChannelSync(
  customerId: string,
  task: () => Promise<void>,
): Promise<void> {
  const prev = customerSyncChains.get(customerId) ?? Promise.resolve();
  const next = prev
    .catch(() => undefined)
    .then(task)
    .finally(() => {
      if (customerSyncChains.get(customerId) === next) {
        customerSyncChains.delete(customerId);
      }
    });
  customerSyncChains.set(customerId, next);
  return next;
}

/** Solo tests: vacía colas en memoria. */
export function resetCustomerChannelSyncQueuesForTests(): void {
  customerSyncChains.clear();
}

/**
 * Agenda trabajo post-respuesta sin bloquear el handler.
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

async function isJobStillCurrent(
  client: PrismaClient,
  customerId: string,
  generation: number,
  target: BotChannelSyncTarget,
): Promise<boolean> {
  const row = await client.customer.findUnique({
    where: { id: customerId },
    select: { botChannelSyncGeneration: true, botChannelSyncTarget: true },
  });
  return (
    !!row &&
    row.botChannelSyncGeneration === generation &&
    row.botChannelSyncTarget === target
  );
}

/**
 * Si un job viejo llegó a mutear/desmutear BBC después de ser supersedido,
 * re-aplica el target vigente (sin tocar generation).
 */
async function reconcileCurrentChannelIfNeeded(
  client: PrismaClient,
  customerId: string,
): Promise<void> {
  const row = await client.customer.findUnique({
    where: { id: customerId },
    select: {
      phone: true,
      botChannelSyncGeneration: true,
      botChannelSyncTarget: true,
      botChannelSyncStatus: true,
    },
  });
  if (!row?.phone) return;
  if (row.botChannelSyncTarget !== "paused" && row.botChannelSyncTarget !== "active") return;
  if (row.botChannelSyncStatus === "synced") {
    // Aunque DB diga synced, un job viejo pudo pisar BBC: forzar re-apply del target vigente.
  }
  const target = row.botChannelSyncTarget as BotChannelSyncTarget;
  const gen = row.botChannelSyncGeneration;
  console.log(
    `[botChannelSync] reconcile channel customer=${customerId} target=${target} gen=${gen}`,
  );
  const result = await applyCloudTarget(row.phone, target);
  if (!(await isJobStillCurrent(client, customerId, gen, target))) {
    console.log(`[botChannelSync] reconcile aborted (superseded) customer=${customerId}`);
    return;
  }
  await client.customer.updateMany({
    where: { id: customerId, botChannelSyncGeneration: gen },
    data: {
      botChannelSyncStatus: result.ok ? "synced" : "error",
      botChannelSyncAt: new Date(),
      botChannelSyncError: result.ok
        ? null
        : `reconcile muteOk=${result.muteOk} blacklistOk=${result.blacklistOk}`,
    },
  });
}

/**
 * Ejecuta mute/blacklist para una generation concreta, serializado por cliente.
 */
export async function runChannelSyncJob(params: {
  customerId: string;
  generation: number;
  target: BotChannelSyncTarget;
  client?: PrismaClient;
}): Promise<void> {
  const client = params.client ?? prisma;
  const { customerId, generation, target } = params;

  await enqueueCustomerChannelSync(customerId, async () => {
    for (let attempt = 1; attempt <= CHANNEL_SYNC_MAX_ATTEMPTS; attempt++) {
      // Releer DESPUÉS de entrar a la cola: puede haber una generation más nueva.
      if (!(await isJobStillCurrent(client, customerId, generation, target))) {
        console.log(
          `[botChannelSync] skip superseded before BBC gen=${generation} customer=${customerId}`,
        );
        return;
      }

      const row = await client.customer.findUnique({
        where: { id: customerId },
        select: { phone: true },
      });
      if (!row) return;

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

      // Último check justo antes de pegarle a Cloud.
      if (!(await isJobStillCurrent(client, customerId, generation, target))) {
        console.log(
          `[botChannelSync] skip superseded pre-call gen=${generation} customer=${customerId}`,
        );
        return;
      }

      const result = await applyCloudTarget(row.phone, target);
      console.log(
        `[botChannelSync] attempt=${attempt}/${CHANNEL_SYNC_MAX_ATTEMPTS} target=${target} customer=${customerId} gen=${generation} ok=${result.ok} bbcMs=${result.ms} muteOk=${result.muteOk} blacklistOk=${result.blacklistOk}`,
      );

      const stillCurrent = await isJobStillCurrent(client, customerId, generation, target);
      if (!stillCurrent) {
        // El canal pudo quedar con el target viejo: reconciliar el vigente.
        console.log(
          `[botChannelSync] stale BBC result gen=${generation} customer=${customerId} → reconcile`,
        );
        await reconcileCurrentChannelIfNeeded(client, customerId);
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
  });
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

/**
 * Incrementa generation + setea target/status de forma atómica (RETURNING).
 * Evita que dos requests concurrentes lean el mismo N y escriban N+1.
 */
export async function bumpChannelSyncGenerationAtomic(
  client: PrismaClient,
  customerId: string,
  target: BotChannelSyncTarget,
): Promise<{
  botChannelSyncGeneration: number;
  botPausedAt: Date | null;
  botPausedSource: string | null;
  botChannelSyncStatus: string;
  botChannelSyncTarget: string | null;
} | null> {
  const rows = await client.$queryRaw<
    Array<{
      botChannelSyncGeneration: number;
      botPausedAt: Date | null;
      botPausedSource: string | null;
      botChannelSyncStatus: string;
      botChannelSyncTarget: string | null;
    }>
  >`
    UPDATE "Customer"
    SET
      "botChannelSyncGeneration" = "botChannelSyncGeneration" + 1,
      "botChannelSyncTarget" = ${target},
      "botChannelSyncStatus" = 'pending',
      "botChannelSyncError" = NULL,
      "botChannelSyncAttempts" = 0,
      "botChannelSyncAt" = NULL
    WHERE id = ${customerId}
    RETURNING
      "botChannelSyncGeneration",
      "botPausedAt",
      "botPausedSource",
      "botChannelSyncStatus",
      "botChannelSyncTarget"
  `;
  return rows[0] ?? null;
}

export function isChannelSyncedForTarget(
  status: string | null | undefined,
  target: string | null | undefined,
  desired: BotChannelSyncTarget,
): boolean {
  return status === "synced" && target === desired;
}
