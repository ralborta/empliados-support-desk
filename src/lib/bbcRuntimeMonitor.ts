import { prisma } from "@/lib/db";

export const BBC_HEARTBEAT_KEY = "bbc";

export type BbcRuntimeStatusKind =
  | "ONLINE"
  | "DEGRADED"
  | "CONFIG_ERROR"
  | "OFFLINE"
  | "UNKNOWN"
  | "READY_TO_SCAN"
  | "INITIALIZATION";

export type BbcRuntimeStatus = {
  key: string;
  status: BbcRuntimeStatusKind;
  healthy: boolean;
  host: string | null;
  detail: string | null;
  lastEventAt: string | null;
  lastOnlineAt: string | null;
  lastOfflineAt: string | null;
  restartCount: number;
  updatedAt: string;
  lastAlertAt: string | null;
  apiProbeOk?: boolean;
  apiProbeMessage?: string;
  apiProbeHttpStatus?: number;
  /** true si este evento indica que el runtime acaba de volver (reinicio). */
  restarted?: boolean;
  source?: string;
};

export type BbcProbeResult = {
  ok: boolean;
  message: string;
  httpStatus?: number;
  configError?: boolean;
};

export type BbcStatusTransition = {
  previousStatus: BbcRuntimeStatusKind | null;
  nextStatus: BbcRuntimeStatusKind;
  changed: boolean;
  alertKind: "offline" | "degraded" | "config_error" | "recovery" | "restart" | null;
};

const ALERT_COOLDOWN_MS = 5 * 60 * 1000;

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

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

function readProbeFromDetail(detail: Record<string, unknown>): {
  apiProbeOk?: boolean;
  apiProbeMessage?: string;
  apiProbeHttpStatus?: number;
} {
  const probe = detail.lastProbe;
  if (!probe || typeof probe !== "object" || Array.isArray(probe)) return {};
  const p = probe as Record<string, unknown>;
  return {
    apiProbeOk: typeof p.ok === "boolean" ? p.ok : undefined,
    apiProbeMessage: typeof p.message === "string" ? p.message : undefined,
    apiProbeHttpStatus: typeof p.httpStatus === "number" ? p.httpStatus : undefined,
  };
}

function normalizeStatus(raw: string | undefined | null): BbcRuntimeStatusKind {
  const s = String(raw ?? "")
    .trim()
    .toUpperCase();
  if (!s) return "UNKNOWN";
  if (s === "ONLINE" || s === "DEGRADED" || s === "CONFIG_ERROR" || s === "OFFLINE") return s;
  if (/ONLINE|CONNECTED|READY$/.test(s) && !/READY_TO_SCAN/.test(s)) return "ONLINE";
  if (/READY_TO_SCAN|QR/.test(s)) return "READY_TO_SCAN";
  if (/OFFLINE|DISCONNECTED|TIMEOUT|FAILED|ERROR/.test(s)) return "OFFLINE";
  if (/INIT/.test(s)) return "INITIALIZATION";
  if (/DEGRADED/.test(s)) return "DEGRADED";
  if (/CONFIG/.test(s)) return "CONFIG_ERROR";
  return "UNKNOWN";
}

function isHealthyStatus(status: BbcRuntimeStatusKind): boolean {
  return status === "ONLINE" || status === "DEGRADED";
}

function rowToStatus(
  row: {
    key: string;
    status: string;
    healthy: boolean;
    host: string | null;
    detail: string | null;
    lastEventAt: Date | null;
    lastOnlineAt: Date | null;
    lastOfflineAt: Date | null;
    restartCount: number;
    updatedAt: Date;
    lastAlertAt: Date | null;
  },
  extras?: Partial<BbcRuntimeStatus>,
): BbcRuntimeStatus {
  const detailObj = parseDetail(row.detail);
  const probe = readProbeFromDetail(detailObj);
  const status = normalizeStatus(row.status);
  return {
    key: row.key,
    status,
    healthy: row.healthy,
    host: row.host,
    detail: row.detail,
    lastEventAt: iso(row.lastEventAt),
    lastOnlineAt: iso(row.lastOnlineAt),
    lastOfflineAt: iso(row.lastOfflineAt),
    restartCount: row.restartCount,
    updatedAt: row.updatedAt.toISOString(),
    lastAlertAt: iso(row.lastAlertAt),
    ...probe,
    ...extras,
  };
}

export function classifyBbcProbeResult(probe: BbcProbeResult): BbcRuntimeStatusKind {
  if (probe.configError) return "CONFIG_ERROR";
  if (probe.ok) return "ONLINE";
  if (probe.httpStatus != null && probe.httpStatus >= 500) return "OFFLINE";
  if (probe.httpStatus === 401 || probe.httpStatus === 403) return "CONFIG_ERROR";
  return "DEGRADED";
}

export function resolveBbcTransition(
  previousStatus: BbcRuntimeStatusKind | null,
  nextStatus: BbcRuntimeStatusKind,
  opts?: { restarted?: boolean },
): BbcStatusTransition {
  const changed = previousStatus !== nextStatus;
  let alertKind: BbcStatusTransition["alertKind"] = null;

  if (opts?.restarted) {
    return { previousStatus, nextStatus, changed: true, alertKind: "restart" };
  }

  if (!changed) {
    return { previousStatus, nextStatus, changed, alertKind: null };
  }

  if (nextStatus === "ONLINE" && previousStatus != null && previousStatus !== "ONLINE") {
    alertKind = "recovery";
  } else if (nextStatus === "OFFLINE") {
    alertKind = "offline";
  } else if (nextStatus === "CONFIG_ERROR") {
    alertKind = "config_error";
  } else if (nextStatus === "DEGRADED") {
    alertKind = "degraded";
  }

  return { previousStatus, nextStatus, changed, alertKind };
}

export function shouldSendBbcTransitionAlert(params: {
  transition: BbcStatusTransition;
  lastAlertAt: Date | null;
  now?: Date;
}): boolean {
  if (!params.transition.alertKind) return false;
  const now = params.now ?? new Date();
  if (params.lastAlertAt && now.getTime() - params.lastAlertAt.getTime() < ALERT_COOLDOWN_MS) {
    return false;
  }
  return true;
}

/** Lee el último heartbeat BBC guardado (monitor / cron). Sin sonda en vivo. */
export async function getBbcRuntimeStatus(): Promise<BbcRuntimeStatus | null> {
  try {
    const row = await prisma.opsServiceHeartbeat.findUnique({
      where: { key: BBC_HEARTBEAT_KEY },
    });
    if (!row) return null;
    return rowToStatus(row);
  } catch (error) {
    console.error("[bbcRuntimeMonitor] get failed:", error);
    return null;
  }
}

export type BbcStatusEventInput = {
  eventName?: string;
  status?: string;
  host?: string;
  raw?: unknown;
  source?: string;
};

/**
 * Persiste un evento de estado BBC (webhook status.ready / status.*).
 * Devuelve `restarted: true` cuando el runtime vuelve a ONLINE tras un hueco
 * (reinicio del contenedor Meta/BBC).
 */
export async function recordBbcStatusEvent(
  input: BbcStatusEventInput,
): Promise<BbcRuntimeStatus & { transition: BbcStatusTransition }> {
  const eventName = String(input.eventName ?? "").trim();
  const fromEvent =
    /status\.ready/i.test(eventName)
      ? "ONLINE"
      : /status\.(offline|disconnect|fail|error|close)/i.test(eventName)
        ? "OFFLINE"
        : input.status;
  const status = normalizeStatus(fromEvent);
  const healthy = isHealthyStatus(status);
  const now = new Date();
  const host = input.host?.trim() || null;
  const prev = await prisma.opsServiceHeartbeat.findUnique({
    where: { key: BBC_HEARTBEAT_KEY },
  });
  const prevDetail = parseDetail(prev?.detail);
  const detail = JSON.stringify({
    ...prevDetail,
    eventName: eventName || null,
    source: input.source ?? "webhook",
    at: now.toISOString(),
    rawPreview:
      input.raw == null
        ? null
        : typeof input.raw === "string"
          ? input.raw.slice(0, 400)
          : JSON.stringify(input.raw).slice(0, 400),
  });

  const gapMs = prev?.lastOnlineAt
    ? now.getTime() - prev.lastOnlineAt.getTime()
    : prev?.lastEventAt
      ? now.getTime() - prev.lastEventAt.getTime()
      : null;

  const restarted =
    healthy &&
    status === "ONLINE" &&
    Boolean(prev) &&
    (normalizeStatus(prev!.status) !== "ONLINE" || (gapMs != null && gapMs > 90_000));

  const restartCount = (prev?.restartCount ?? 0) + (restarted ? 1 : 0);
  const previousStatus = prev ? normalizeStatus(prev.status) : null;
  const transition = resolveBbcTransition(previousStatus, status, { restarted });

  const row = await prisma.opsServiceHeartbeat.upsert({
    where: { key: BBC_HEARTBEAT_KEY },
    create: {
      key: BBC_HEARTBEAT_KEY,
      status,
      healthy,
      host,
      detail,
      lastEventAt: now,
      lastOnlineAt: healthy ? now : null,
      lastOfflineAt: healthy ? null : now,
      restartCount: restarted ? 1 : 0,
    },
    update: {
      status,
      healthy,
      host: host ?? undefined,
      detail,
      lastEventAt: now,
      lastOnlineAt: healthy ? now : undefined,
      lastOfflineAt: healthy ? undefined : now,
      restartCount,
    },
  });

  return {
    ...rowToStatus(row, {
      restarted,
      source: input.source ?? "webhook",
    }),
    transition,
  };
}

/** Cron: sonda API, persiste estado y devuelve transición para alertas. */
export async function persistBbcCronProbe(params: {
  probe: BbcProbeResult;
  host?: string | null;
  probedAt?: Date;
}): Promise<{ status: BbcRuntimeStatus; transition: BbcStatusTransition }> {
  const probedAt = params.probedAt ?? new Date();
  const nextStatus = classifyBbcProbeResult(params.probe);
  const healthy = isHealthyStatus(nextStatus);

  const prev = await prisma.opsServiceHeartbeat.findUnique({
    where: { key: BBC_HEARTBEAT_KEY },
  });
  const previousStatus = prev ? normalizeStatus(prev.status) : null;
  const transition = resolveBbcTransition(previousStatus, nextStatus);

  const mergedDetail = {
    ...parseDetail(prev?.detail),
    lastProbe: {
      at: probedAt.toISOString(),
      ok: params.probe.ok,
      message: params.probe.message,
      httpStatus: params.probe.httpStatus ?? null,
    },
    source: "cron_probe",
    at: probedAt.toISOString(),
  };

  const row = await prisma.opsServiceHeartbeat.upsert({
    where: { key: BBC_HEARTBEAT_KEY },
    create: {
      key: BBC_HEARTBEAT_KEY,
      status: nextStatus,
      healthy,
      host: params.host ?? null,
      detail: JSON.stringify(mergedDetail),
      lastEventAt: probedAt,
      lastOnlineAt: healthy ? probedAt : null,
      lastOfflineAt: healthy ? null : probedAt,
      restartCount: 0,
    },
    update: {
      status: nextStatus,
      healthy,
      host: params.host ?? undefined,
      detail: JSON.stringify(mergedDetail),
      lastEventAt: probedAt,
      ...(healthy ? { lastOnlineAt: probedAt } : { lastOfflineAt: probedAt }),
    },
  });

  return {
    status: rowToStatus(row, { source: "cron_probe" }),
    transition,
  };
}

export async function markBbcAlertSent(at?: Date): Promise<void> {
  const sentAt = at ?? new Date();
  await prisma.opsServiceHeartbeat.upsert({
    where: { key: BBC_HEARTBEAT_KEY },
    create: {
      key: BBC_HEARTBEAT_KEY,
      status: "UNKNOWN",
      healthy: false,
      lastAlertAt: sentAt,
    },
    update: {
      lastAlertAt: sentAt,
    },
  });
}

/**
 * Probe liviano vía API de mensajes BBC: si el cloud rechaza con 5xx / red,
 * el runtime o la API no están sanos. No envía WhatsApp real (número inválido).
 */
export async function probeBbcMessagingApi(): Promise<BbcProbeResult> {
  const botId = process.env.BUILDERBOT_BOT_ID?.trim() || "";
  const apiKey = process.env.BUILDERBOT_API_KEY?.trim() || "";
  const base = (process.env.BUILDERBOT_BASE_URL || "https://app.builderbot.cloud").replace(
    /\/$/,
    "",
  );
  if (!botId || !apiKey) {
    return {
      ok: false,
      message: "Faltan BUILDERBOT_BOT_ID / BUILDERBOT_API_KEY",
      configError: true,
    };
  }

  try {
    const res = await fetch(`${base}/api/v2/${botId}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "x-api-builderbot": apiKey,
      },
      body: JSON.stringify({
        messages: { content: " " },
        number: "00",
        checkIfExists: false,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });

    if (res.status >= 500) {
      return {
        ok: false,
        message: `BBC API respondió HTTP ${res.status}`,
        httpStatus: res.status,
      };
    }
    if (res.status === 401 || res.status === 403) {
      return {
        ok: false,
        message: `BBC API respondió HTTP ${res.status} (credenciales)`,
        httpStatus: res.status,
        configError: true,
      };
    }
    return {
      ok: true,
      message: `BBC API alcanzable (HTTP ${res.status})`,
      httpStatus: res.status,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, message: `No se pudo contactar BBC API: ${detail}` };
  }
}
