import { prisma } from "@/lib/db";
import {
  probeBuilderBotDeployStatus,
  rebootBuilderBotDeploy,
  type BuilderBotDeployStatusProbe,
} from "@/lib/builderbotMcpClient";

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
  deployStatus?: string | null;
  deployProbeOk?: boolean;
  deployProbeMessage?: string;
  silenceDetected?: boolean;
  silenceDetail?: string | null;
  lastAutoRebootAt?: string | null;
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
  alertKind:
    | "offline"
    | "degraded"
    | "config_error"
    | "recovery"
    | "restart"
    | "silence"
    | "auto_reboot"
    | null;
};

const ALERT_COOLDOWN_MS = 5 * 60 * 1000;
export const BBC_AUTO_REBOOT_COOLDOWN_MS = 30 * 60 * 1000;
export const BBC_SILENCE_LOOKBACK_MS = 12 * 60 * 1000;
export const BBC_SILENCE_MIN_INBOUND = 2;
export const BBC_SILENCE_MIN_AGE_MS = 3 * 60 * 1000;

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
  deployStatus?: string | null;
  deployProbeOk?: boolean;
  deployProbeMessage?: string;
  silenceDetected?: boolean;
  silenceDetail?: string | null;
  lastAutoRebootAt?: string | null;
} {
  const probe = detail.lastProbe;
  const p =
    probe && typeof probe === "object" && !Array.isArray(probe)
      ? (probe as Record<string, unknown>)
      : {};
  const deploy = detail.lastDeployProbe;
  const d =
    deploy && typeof deploy === "object" && !Array.isArray(deploy)
      ? (deploy as Record<string, unknown>)
      : {};
  const silence = detail.lastSilence;
  const s =
    silence && typeof silence === "object" && !Array.isArray(silence)
      ? (silence as Record<string, unknown>)
      : {};
  return {
    apiProbeOk: typeof p.ok === "boolean" ? p.ok : undefined,
    apiProbeMessage: typeof p.message === "string" ? p.message : undefined,
    apiProbeHttpStatus: typeof p.httpStatus === "number" ? p.httpStatus : undefined,
    deployStatus: typeof d.status === "string" ? d.status : null,
    deployProbeOk: typeof d.ok === "boolean" ? d.ok : undefined,
    deployProbeMessage: typeof d.message === "string" ? d.message : undefined,
    silenceDetected: typeof s.detected === "boolean" ? s.detected : undefined,
    silenceDetail: typeof s.detail === "string" ? s.detail : null,
    lastAutoRebootAt:
      typeof detail.lastAutoRebootAt === "string" ? detail.lastAutoRebootAt : null,
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
  } else if (
    nextStatus === "UNKNOWN" ||
    nextStatus === "READY_TO_SCAN" ||
    nextStatus === "INITIALIZATION"
  ) {
    // Meta Cloud: READY_TO_SCAN/UNKNOWN suelen ser runtime BBC caído, no QR.
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

export function classifyDeployStatusProbe(
  probe: BuilderBotDeployStatusProbe,
): BbcRuntimeStatusKind {
  if (probe.configError && !probe.status) return "CONFIG_ERROR";
  if (!probe.status) return "UNKNOWN";
  return normalizeStatus(probe.status);
}

/**
 * Combina sonda de deploy (Meta/runtime) + API de mensajes.
 * Prioridad: CONFIG_ERROR de credenciales → status de deploy → messaging.
 */
export function combineBbcHealthProbes(params: {
  deploy: BuilderBotDeployStatusProbe | null;
  messaging: BbcProbeResult;
}): { status: BbcRuntimeStatusKind; healthy: boolean; source: string } {
  const messagingStatus = classifyBbcProbeResult(params.messaging);

  if (params.messaging.configError) {
    return { status: "CONFIG_ERROR", healthy: false, source: "messaging_config" };
  }

  // Timeout / fallo MCP sin status explícito → UNKNOWN (alerta, no reboot).
  if (
    params.deploy &&
    !params.deploy.configError &&
    !params.deploy.status &&
    !params.deploy.ok
  ) {
    return { status: "UNKNOWN", healthy: false, source: "deploy_probe_failed" };
  }

  if (params.deploy && !params.deploy.configError && params.deploy.status) {
    const deployStatus = classifyDeployStatusProbe(params.deploy);
    if (deployStatus !== "ONLINE") {
      return { status: deployStatus, healthy: false, source: "deploy_status" };
    }
    if (messagingStatus === "OFFLINE") {
      return { status: "OFFLINE", healthy: false, source: "messaging_offline" };
    }
    if (messagingStatus === "DEGRADED") {
      return { status: "DEGRADED", healthy: true, source: "deploy_online_messaging_degraded" };
    }
    return { status: "ONLINE", healthy: true, source: "deploy_and_messaging" };
  }

  // Sin MCP key / deploy probe: caer a messaging (comportamiento histórico).
  return {
    status: messagingStatus,
    healthy: isHealthyStatus(messagingStatus),
    source: params.deploy?.configError ? "messaging_fallback_mcp_missing" : "messaging_only",
  };
}

export type BbcSilenceSample = {
  phone: string;
  direction: "INBOUND" | "OUTBOUND";
  from: string;
  at: Date;
  botPaused?: boolean;
  /** Turn pidió no enviar (ignore / skip). Nunca cuenta como entregable. */
  skipResponse?: boolean;
  /** /turn generó mensaje destinado al cliente (skipResponse=false). */
  turnDeliverableReply?: boolean;
  waDeliveryState?: string | null;
  /** Canal declarado al persistir (bbc | backend | …). */
  waDeliveryChannel?: string | null;
  /** Wamid / provider id → outbound confirmado por Meta/BBC. */
  hasProviderWamid?: boolean;
};

export type BbcSilenceCheck = {
  detected: boolean;
  detail: string;
  affectedPhones: string[];
};

function isDeliverableTurnEvidence(s: BbcSilenceSample): boolean {
  if (s.skipResponse) return false;
  if (s.turnDeliverableReply) return true;
  const state = String(s.waDeliveryState ?? "").trim();
  if (state === "send_initiated" || state === "presaved") return true;
  if (
    s.direction === "OUTBOUND" &&
    s.from === "BOT" &&
    !s.hasProviderWamid &&
    (s.waDeliveryChannel === "bbc" ||
      s.waDeliveryChannel === "bbc_fallback" ||
      s.waDeliveryChannel === "gps_media_bbc_text")
  ) {
    return true;
  }
  return false;
}

function clearsSilenceAfter(s: BbcSilenceSample, evidenceAt: Date): boolean {
  if (s.at.getTime() < evidenceAt.getTime()) return false;
  if (s.direction !== "OUTBOUND") return false;
  if (s.from === "HUMAN") return true;
  if (s.from === "BOT" && s.hasProviderWamid) return true;
  if (s.from === "BOT" && s.waDeliveryState === "delivered") return true;
  return false;
}

/**
 * Silencio funcional: requiere evidencia de respuesta entregable de /turn
 * y ausencia de outbound confirmado (BBC/Meta) u otra ruta. No basta con N inbounds.
 */
export function evaluateBbcFunctionalSilence(
  samples: BbcSilenceSample[],
  opts?: { now?: Date; lookbackMs?: number; minAgeMs?: number },
): BbcSilenceCheck {
  const now = opts?.now ?? new Date();
  const lookbackMs = opts?.lookbackMs ?? BBC_SILENCE_LOOKBACK_MS;
  const minAgeMs = opts?.minAgeMs ?? BBC_SILENCE_MIN_AGE_MS;
  const since = now.getTime() - lookbackMs;

  const active = samples
    .filter((s) => s.at.getTime() >= since && !s.botPaused)
    .sort((a, b) => a.at.getTime() - b.at.getTime());

  const byPhone = new Map<string, BbcSilenceSample[]>();
  for (const s of active) {
    const phone = s.phone.replace(/\D/g, "");
    if (phone.length < 8) continue;
    const list = byPhone.get(phone) ?? [];
    list.push(s);
    byPhone.set(phone, list);
  }

  const affected: string[] = [];
  for (const [phone, msgs] of byPhone) {
    const evidence = msgs.filter(isDeliverableTurnEvidence);
    if (!evidence.length) continue;
    const lastEv = evidence[evidence.length - 1]!;
    if (now.getTime() - lastEv.at.getTime() < minAgeMs) continue;
    const cleared = msgs.some((m) => clearsSilenceAfter(m, lastEv.at));
    if (!cleared) affected.push(phone);
  }

  if (!affected.length) {
    return { detected: false, detail: "Sin silencio funcional", affectedPhones: [] };
  }
  return {
    detected: true,
    detail: `${affected.length} teléfono(s) con turn entregable sin outbound BBC/Meta confirmado (>${Math.round(minAgeMs / 60000)} min)`,
    affectedPhones: affected,
  };
}

function readTurnMetaFromPayload(raw: unknown): {
  skipResponse?: boolean;
  turnDeliverableReply?: boolean;
  waDeliveryState?: string | null;
  waDeliveryChannel?: string | null;
} {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const p = raw as Record<string, unknown>;
  const nested = p.waTurnDelivery;
  const delivery =
    nested && typeof nested === "object" && !Array.isArray(nested)
      ? (nested as Record<string, unknown>)
      : {};
  const skipRaw = p.skipResponse_s ?? p.skipResponse;
  const skipResponse =
    skipRaw === true || String(skipRaw ?? "").trim().toLowerCase() === "true";
  const message = String(p.message ?? p.summaryText ?? p.deliveredMessage ?? "").trim();
  const channel = String(p.waDelivery ?? p.waDelivery_s ?? "").trim() || null;
  const state =
    typeof delivery.waDeliveryState === "string"
      ? delivery.waDeliveryState
      : typeof p.waDeliveryState === "string"
        ? p.waDeliveryState
        : null;
  const turnDeliverableReply =
    !skipResponse &&
    (message.length > 0 ||
      state === "send_initiated" ||
      state === "presaved" ||
      channel === "bbc" ||
      channel === "backend" ||
      channel === "bbc_fallback");
  return {
    skipResponse,
    turnDeliverableReply: turnDeliverableReply || undefined,
    waDeliveryState: state,
    waDeliveryChannel: channel,
  };
}

export async function probeBbcFunctionalSilence(
  lookbackMs = BBC_SILENCE_LOOKBACK_MS,
): Promise<BbcSilenceCheck> {
  const since = new Date(Date.now() - lookbackMs);
  try {
    const rows = await prisma.ticketMessage.findMany({
      where: {
        createdAt: { gte: since },
        direction: { in: ["INBOUND", "OUTBOUND"] },
      },
      select: {
        direction: true,
        from: true,
        createdAt: true,
        externalMessageId: true,
        rawPayload: true,
        ticket: {
          select: {
            customer: { select: { phone: true, botPausedAt: true } },
          },
        },
      },
      orderBy: { createdAt: "asc" },
      take: 400,
    });
    return evaluateBbcFunctionalSilence(
      rows.map((r) => {
        const meta = readTurnMetaFromPayload(r.rawPayload);
        const ext = String(r.externalMessageId ?? "").trim();
        return {
          phone: r.ticket.customer.phone,
          direction: r.direction as "INBOUND" | "OUTBOUND",
          from: r.from,
          at: r.createdAt,
          botPaused: Boolean(r.ticket.customer.botPausedAt),
          skipResponse: meta.skipResponse,
          turnDeliverableReply: meta.turnDeliverableReply,
          waDeliveryState: meta.waDeliveryState,
          waDeliveryChannel: meta.waDeliveryChannel,
          hasProviderWamid: /^wamid\./i.test(ext),
        };
      }),
    );
  } catch (error) {
    console.error("[bbcRuntimeMonitor] silence probe failed:", error);
    return {
      detected: false,
      detail: "No se pudo evaluar silencio (error DB)",
      affectedPhones: [],
    };
  }
}

/** Opt-in estricto: solo `true` exacto (case-insensitive). Default = desactivado. */
export function isBbcAutoRebootEnabled(): boolean {
  return process.env.WARA_BBC_AUTO_REBOOT?.trim().toLowerCase() === "true";
}

export function bbcAutoRebootCooldownMs(): number {
  const mins = Number(process.env.WARA_BBC_AUTO_REBOOT_COOLDOWN_MIN?.trim() || "30");
  if (!Number.isFinite(mins) || mins < 5) return BBC_AUTO_REBOOT_COOLDOWN_MS;
  return Math.round(mins * 60_000);
}

/**
 * Reboot automático (solo si opt-in).
 * - Nunca CONFIG_ERROR
 * - Nunca UNKNOWN (timeout/fallo MCP → solo alerta)
 * - Silencio solo con evidencia de turn entregable
 */
export function shouldAutoRebootBbc(params: {
  status: BbcRuntimeStatusKind;
  silenceDetected: boolean;
  /** false si UNKNOWN viene de timeout/error MCP sin status explícito */
  deployStatusReliable?: boolean;
  lastAutoRebootAt: Date | null;
  enabled?: boolean;
  now?: Date;
  cooldownMs?: number;
}): boolean {
  if (!(params.enabled ?? isBbcAutoRebootEnabled())) return false;
  if (params.status === "CONFIG_ERROR") return false;
  if (params.status === "UNKNOWN") return false;
  const now = params.now ?? new Date();
  const cooldown = params.cooldownMs ?? bbcAutoRebootCooldownMs();
  if (
    params.lastAutoRebootAt &&
    now.getTime() - params.lastAutoRebootAt.getTime() < cooldown
  ) {
    return false;
  }
  if (params.silenceDetected) return true;
  if (params.deployStatusReliable === false) return false;
  return (
    params.status === "OFFLINE" ||
    params.status === "READY_TO_SCAN" ||
    params.status === "INITIALIZATION"
  );
}

export type BbcCronHealthCycleResult = {
  status: BbcRuntimeStatus;
  transition: BbcStatusTransition;
  silence: BbcSilenceCheck;
  messaging: BbcProbeResult;
  deploy: BuilderBotDeployStatusProbe | null;
  reboot: {
    attempted: boolean;
    ok: boolean;
    message: string | null;
    skippedReason?: string | null;
  };
  alertKinds: Array<NonNullable<BbcStatusTransition["alertKind"]>>;
};

/**
 * Ciclo completo del cron: sondas → persistir → silencio → reboot opt-in con lock.
 */
export async function runBbcHealthCronCycle(): Promise<BbcCronHealthCycleResult> {
  const { finalizeBbcRebootAttempt, tryAcquireBbcRebootLock } = await import(
    "@/lib/bbcRebootLock"
  );

  const botId = process.env.BUILDERBOT_BOT_ID?.trim() || "";
  const messaging = await probeBbcMessagingApi();
  let deploy: BuilderBotDeployStatusProbe | null = null;
  if (botId) {
    deploy = await probeBuilderBotDeployStatus(botId);
  } else {
    deploy = {
      ok: false,
      status: null,
      message: "Falta BUILDERBOT_BOT_ID",
      configError: true,
    };
  }

  const combined = combineBbcHealthProbes({ deploy, messaging });
  const silence = await probeBbcFunctionalSilence();
  const prev = await prisma.opsServiceHeartbeat.findUnique({
    where: { key: BBC_HEARTBEAT_KEY },
  });
  const prevDetail = parseDetail(prev?.detail);
  const previousStatus = prev ? normalizeStatus(prev.status) : null;
  const transition = resolveBbcTransition(previousStatus, combined.status);

  const lastAutoRebootAtRaw =
    typeof prevDetail.lastAutoRebootAt === "string" ? prevDetail.lastAutoRebootAt : null;
  const lastAutoRebootAt = lastAutoRebootAtRaw ? new Date(lastAutoRebootAtRaw) : null;

  let reboot: BbcCronHealthCycleResult["reboot"] = {
    attempted: false,
    ok: false,
    message: null,
    skippedReason: null,
  };

  const deployStatusReliable = Boolean(deploy?.status && !deploy.configError);
  const wantReboot = shouldAutoRebootBbc({
    status: combined.status,
    silenceDetected: silence.detected,
    deployStatusReliable,
    lastAutoRebootAt,
  });

  const now = new Date();

  if (wantReboot && botId) {
    const reason = silence.detected ? `silence:${silence.detail}` : `status:${combined.status}`;
    const lock = await tryAcquireBbcRebootLock({ reason, now });
    if (!lock.acquired) {
      reboot.skippedReason = lock.reason;
      reboot.message = `Lock no adquirido (${lock.reason})`;
    } else {
      reboot.attempted = true;
      const result = await rebootBuilderBotDeploy(botId);
      reboot.ok = result.ok;
      reboot.message = result.message;
      await finalizeBbcRebootAttempt({
        attemptId: lock.attempt.id,
        ok: result.ok,
        message: result.message,
        now,
      });
    }
  } else if (wantReboot && !botId) {
    reboot.skippedReason = "missing_bot_id";
  } else if (!isBbcAutoRebootEnabled()) {
    reboot.skippedReason = "auto_reboot_disabled";
  }

  const after = await prisma.opsServiceHeartbeat.findUnique({
    where: { key: BBC_HEARTBEAT_KEY },
  });
  const afterDetail = parseDetail(after?.detail);
  const autoRebootAt =
    typeof afterDetail.lastAutoRebootAt === "string"
      ? afterDetail.lastAutoRebootAt
      : lastAutoRebootAtRaw;
  const restartCount = after?.restartCount ?? prev?.restartCount ?? 0;

  const healthy = isHealthyStatus(combined.status) && !silence.detected;
  const alertKinds: BbcCronHealthCycleResult["alertKinds"] = [];
  if (transition.alertKind) alertKinds.push(transition.alertKind);
  if (silence.detected) alertKinds.push("silence");
  if (reboot.attempted) alertKinds.push("auto_reboot");

  const mergedDetail = {
    ...afterDetail,
    lastProbe: {
      at: now.toISOString(),
      ok: messaging.ok,
      message: messaging.message,
      httpStatus: messaging.httpStatus ?? null,
    },
    lastDeployProbe: deploy
      ? {
          at: now.toISOString(),
          ok: deploy.ok,
          status: deploy.status,
          message: deploy.message,
          reliable: deployStatusReliable,
        }
      : afterDetail.lastDeployProbe ?? null,
    lastSilence: {
      at: now.toISOString(),
      detected: silence.detected,
      detail: silence.detail,
      phones: silence.affectedPhones.slice(0, 8),
    },
    lastAutoRebootAt: autoRebootAt,
    source: "cron_probe",
    combineSource: combined.source,
    at: now.toISOString(),
  };

  const row = await prisma.opsServiceHeartbeat.upsert({
    where: { key: BBC_HEARTBEAT_KEY },
    create: {
      key: BBC_HEARTBEAT_KEY,
      status: silence.detected && combined.status === "ONLINE" ? "DEGRADED" : combined.status,
      healthy,
      detail: JSON.stringify(mergedDetail),
      lastEventAt: now,
      lastOnlineAt: healthy ? now : null,
      lastOfflineAt: healthy ? null : now,
      restartCount,
    },
    update: {
      status: silence.detected && combined.status === "ONLINE" ? "DEGRADED" : combined.status,
      healthy,
      detail: JSON.stringify(mergedDetail),
      lastEventAt: now,
      restartCount,
      ...(healthy ? { lastOnlineAt: now } : { lastOfflineAt: now }),
    },
  });

  const persistedStatus = normalizeStatus(row.status);
  return {
    status: rowToStatus(row, {
      source: "cron_probe",
      silenceDetected: silence.detected,
      silenceDetail: silence.detail,
    }),
    transition: resolveBbcTransition(previousStatus, persistedStatus),
    silence,
    messaging,
    deploy,
    reboot,
    alertKinds: [...new Set(alertKinds)],
  };
}
