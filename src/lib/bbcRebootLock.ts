/**
 * Lock atómico + auditoría de intentos de auto-reboot BBC.
 * CAS sobre `detail` del heartbeat para cron HTTP, in-process y réplicas.
 */
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";

/** Misma key que bbcRuntimeMonitor — evitar import circular. */
export const BBC_HEARTBEAT_KEY = "bbc";
export const BBC_AUTO_REBOOT_COOLDOWN_MS = 30 * 60 * 1000;
export const BBC_REBOOT_LOCK_TTL_MS = 2 * 60 * 1000;

function bbcAutoRebootCooldownMs(): number {
  const mins = Number(process.env.WARA_BBC_AUTO_REBOOT_COOLDOWN_MIN?.trim() || "30");
  if (!Number.isFinite(mins) || mins < 5) return BBC_AUTO_REBOOT_COOLDOWN_MS;
  return Math.round(mins * 60_000);
}

export type BbcRebootAttemptState = "initiated" | "succeeded" | "failed" | "skipped_lock";

export type BbcRebootAttempt = {
  id: string;
  at: string;
  reason: string;
  state: BbcRebootAttemptState;
  message?: string | null;
  lockUntil?: string;
};

function parseDetail(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function readRebootLockState(
  detail: Record<string, unknown>,
  opts?: { now?: Date; cooldownMs?: number },
): { locked: boolean; inCooldown: boolean; lastAttempt: BbcRebootAttempt | null } {
  const now = opts?.now ?? new Date();
  const cooldownMs = opts?.cooldownMs ?? BBC_AUTO_REBOOT_COOLDOWN_MS;
  const lockUntilRaw =
    typeof detail.rebootLockUntil === "string" ? detail.rebootLockUntil : null;
  const lockUntil = lockUntilRaw ? new Date(lockUntilRaw) : null;
  const locked = Boolean(lockUntil && !Number.isNaN(lockUntil.getTime()) && lockUntil > now);

  const lastAutoRaw =
    typeof detail.lastAutoRebootAt === "string" ? detail.lastAutoRebootAt : null;
  const lastAuto = lastAutoRaw ? new Date(lastAutoRaw) : null;
  const inCooldown = Boolean(
    lastAuto &&
      !Number.isNaN(lastAuto.getTime()) &&
      now.getTime() - lastAuto.getTime() < cooldownMs,
  );

  const rawAttempt = detail.lastRebootAttempt;
  let lastAttempt: BbcRebootAttempt | null = null;
  if (rawAttempt && typeof rawAttempt === "object" && !Array.isArray(rawAttempt)) {
    const a = rawAttempt as Record<string, unknown>;
    if (typeof a.id === "string" && typeof a.at === "string" && typeof a.reason === "string") {
      lastAttempt = {
        id: a.id,
        at: a.at,
        reason: a.reason,
        state: (typeof a.state === "string" ? a.state : "initiated") as BbcRebootAttemptState,
        message: typeof a.message === "string" ? a.message : null,
        lockUntil: typeof a.lockUntil === "string" ? a.lockUntil : undefined,
      };
    }
  }

  return { locked, inCooldown, lastAttempt };
}

/** Pure: ¿se podría adquirir el lock con este snapshot? */
export function canAcquireBbcRebootLock(
  detail: Record<string, unknown>,
  opts?: { now?: Date; cooldownMs?: number },
): boolean {
  const { locked, inCooldown } = readRebootLockState(detail, opts);
  return !locked && !inCooldown;
}

export type AcquireBbcRebootLockResult =
  | { acquired: true; attempt: BbcRebootAttempt; detailBefore: string | null }
  | { acquired: false; reason: "locked" | "cooldown" | "lost_race"; attempt: BbcRebootAttempt | null };

/**
 * Adquiere lock y persiste intento `initiated` ANTES de llamar al MCP.
 * CAS: solo gana quien actualiza el `detail` exacto leído.
 */
export async function tryAcquireBbcRebootLock(params: {
  reason: string;
  now?: Date;
  lockTtlMs?: number;
  cooldownMs?: number;
}): Promise<AcquireBbcRebootLockResult> {
  const now = params.now ?? new Date();
  const lockTtlMs = params.lockTtlMs ?? BBC_REBOOT_LOCK_TTL_MS;
  const cooldownMs = params.cooldownMs ?? bbcAutoRebootCooldownMs();
  const lockUntil = new Date(now.getTime() + lockTtlMs);
  const attemptId = randomUUID();

  return prisma.$transaction(async (tx) => {
    const row = await tx.opsServiceHeartbeat.findUnique({
      where: { key: BBC_HEARTBEAT_KEY },
    });
    const detail = parseDetail(row?.detail);
    const gate = readRebootLockState(detail, { now, cooldownMs });
    if (gate.locked) {
      return { acquired: false as const, reason: "locked" as const, attempt: gate.lastAttempt };
    }
    if (gate.inCooldown) {
      return { acquired: false as const, reason: "cooldown" as const, attempt: gate.lastAttempt };
    }

    const attempt: BbcRebootAttempt = {
      id: attemptId,
      at: now.toISOString(),
      reason: params.reason,
      state: "initiated",
      message: null,
      lockUntil: lockUntil.toISOString(),
    };
    const nextDetail = {
      ...detail,
      rebootLockUntil: lockUntil.toISOString(),
      lastRebootAttempt: attempt,
    };
    const nextDetailStr = JSON.stringify(nextDetail);

    if (!row) {
      await tx.opsServiceHeartbeat.create({
        data: {
          key: BBC_HEARTBEAT_KEY,
          status: "UNKNOWN",
          healthy: false,
          detail: nextDetailStr,
          lastEventAt: now,
        },
      });
      return {
        acquired: true as const,
        attempt,
        detailBefore: null,
      };
    }

    const updated = await tx.opsServiceHeartbeat.updateMany({
      where: {
        key: BBC_HEARTBEAT_KEY,
        // CAS: otro worker que cambió detail pierde la carrera
        detail: row.detail,
      },
      data: {
        detail: nextDetailStr,
        lastEventAt: now,
      },
    });

    if (updated.count !== 1) {
      return {
        acquired: false as const,
        reason: "lost_race" as const,
        attempt: null,
      };
    }

    return {
      acquired: true as const,
      attempt,
      detailBefore: row.detail,
    };
  });
}

/** Cierra el intento (ok o fail), libera lock y aplica cooldown vía lastAutoRebootAt. */
export async function finalizeBbcRebootAttempt(params: {
  attemptId: string;
  ok: boolean;
  message: string | null;
  now?: Date;
}): Promise<void> {
  const now = params.now ?? new Date();
  const row = await prisma.opsServiceHeartbeat.findUnique({
    where: { key: BBC_HEARTBEAT_KEY },
  });
  if (!row) return;
  const detail = parseDetail(row.detail);
  const prior = detail.lastRebootAttempt;
  const priorObj =
    prior && typeof prior === "object" && !Array.isArray(prior)
      ? (prior as Record<string, unknown>)
      : null;
  if (!priorObj || priorObj.id !== params.attemptId) {
    // Otro intento tomó el slot; no pisar.
    return;
  }

  const attempt: BbcRebootAttempt = {
    id: params.attemptId,
    at: typeof priorObj.at === "string" ? priorObj.at : now.toISOString(),
    reason: typeof priorObj.reason === "string" ? priorObj.reason : "unknown",
    state: params.ok ? "succeeded" : "failed",
    message: params.message,
  };

  const nextDetail = {
    ...detail,
    rebootLockUntil: null,
    lastRebootAttempt: attempt,
    // Cooldown también tras fallo: evita tormentas si MCP timeout-loop.
    lastAutoRebootAt: now.toISOString(),
  };

  await prisma.opsServiceHeartbeat.updateMany({
    where: { key: BBC_HEARTBEAT_KEY, detail: row.detail },
    data: {
      detail: JSON.stringify(nextDetail),
      ...(params.ok ? { restartCount: { increment: 1 } } : {}),
      lastEventAt: now,
    },
  });
}
