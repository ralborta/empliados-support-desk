import { prisma } from "@/lib/db";

export const BBC_HEARTBEAT_KEY = "bbc";

export type BbcRuntimeStatus = {
  key: string;
  status: string;
  healthy: boolean;
  host: string | null;
  detail: string | null;
  lastEventAt: string | null;
  lastOnlineAt: string | null;
  lastOfflineAt: string | null;
  restartCount: number;
  updatedAt: string;
  /** true si este evento indica que el runtime acaba de volver (reinicio). */
  restarted?: boolean;
  source?: string;
};

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

function normalizeStatus(raw: string | undefined | null): string {
  const s = String(raw ?? "")
    .trim()
    .toUpperCase();
  if (!s) return "UNKNOWN";
  if (/ONLINE|CONNECTED|READY$/.test(s) && !/READY_TO_SCAN/.test(s)) return "ONLINE";
  if (/READY_TO_SCAN|QR/.test(s)) return "READY_TO_SCAN";
  if (/OFFLINE|DISCONNECTED|TIMEOUT|FAILED|ERROR/.test(s)) return "OFFLINE";
  if (/INIT/.test(s)) return "INITIALIZATION";
  return s.slice(0, 40);
}

function isHealthyStatus(status: string): boolean {
  return status === "ONLINE";
}

/** Lee el último heartbeat BBC guardado (monitor / cron). */
export async function getBbcRuntimeStatus(): Promise<BbcRuntimeStatus | null> {
  try {
    const row = await prisma.opsServiceHeartbeat.findUnique({
      where: { key: BBC_HEARTBEAT_KEY },
    });
    if (!row) return null;
    return {
      key: row.key,
      status: row.status,
      healthy: row.healthy,
      host: row.host,
      detail: row.detail,
      lastEventAt: iso(row.lastEventAt),
      lastOnlineAt: iso(row.lastOnlineAt),
      lastOfflineAt: iso(row.lastOfflineAt),
      restartCount: row.restartCount,
      updatedAt: row.updatedAt.toISOString(),
    };
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
  input: BbcStatusEventInput
): Promise<BbcRuntimeStatus> {
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
  const detail = JSON.stringify({
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

  const prev = await prisma.opsServiceHeartbeat.findUnique({
    where: { key: BBC_HEARTBEAT_KEY },
  });

  const gapMs = prev?.lastOnlineAt
    ? now.getTime() - prev.lastOnlineAt.getTime()
    : prev?.lastEventAt
      ? now.getTime() - prev.lastEventAt.getTime()
      : null;

  // status.ready solo llega al (re)arranque del runtime → reinicio si ya había estado previo
  // o si el hueco desde el último ONLINE es > 90s.
  const restarted =
    healthy &&
    Boolean(prev) &&
    (prev!.status !== "ONLINE" || (gapMs != null && gapMs > 90_000));

  const restartCount = (prev?.restartCount ?? 0) + (restarted ? 1 : 0);

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
    key: row.key,
    status: row.status,
    healthy: row.healthy,
    host: row.host,
    detail: row.detail,
    lastEventAt: iso(row.lastEventAt),
    lastOnlineAt: iso(row.lastOnlineAt),
    lastOfflineAt: iso(row.lastOfflineAt),
    restartCount: row.restartCount,
    updatedAt: row.updatedAt.toISOString(),
    restarted,
    source: input.source ?? "webhook",
  };
}

/**
 * Probe liviano vía API de mensajes BBC: si el cloud rechaza con 5xx / red,
 * el runtime o la API no están sanos. No envía WhatsApp real (número inválido).
 */
export async function probeBbcMessagingApi(): Promise<{
  ok: boolean;
  message: string;
  httpStatus?: number;
}> {
  const botId = process.env.BUILDERBOT_BOT_ID?.trim() || "";
  const apiKey = process.env.BUILDERBOT_API_KEY?.trim() || "";
  const base = (process.env.BUILDERBOT_BASE_URL || "https://app.builderbot.cloud").replace(
    /\/$/,
    ""
  );
  if (!botId || !apiKey) {
    return { ok: false, message: "Faltan BUILDERBOT_BOT_ID / BUILDERBOT_API_KEY" };
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

    // 4xx = API viva (validación). 5xx / red = problema.
    if (res.status >= 500) {
      return {
        ok: false,
        message: `BBC API respondió HTTP ${res.status}`,
        httpStatus: res.status,
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
