/**
 * Resumen diario de encuestas Kira → mail a Lucas/Emiliano.
 * Un mail por día (día calendario ART), no por cliente.
 */
import { prisma } from "@/lib/db";
import { listServiceFeedback } from "@/lib/kiraServiceFeedbackQuery";
import { sendServiceFeedbackDailySummaryEmail } from "@/lib/panelEmail";

const HEARTBEAT_KEY = "kira_feedback_daily";
const ART = "America/Argentina/Buenos_Aires";

function artParts(d: Date): { y: number; m: number; day: number; hour: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: ART,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  });
  const map = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
  return {
    y: Number(map.year),
    m: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour === "24" ? "0" : map.hour),
  };
}

function dayKeyFromParts(y: number, m: number, day: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Día calendario ART de ayer (YYYY-MM-DD). */
export function argentinaYesterdayKey(now = new Date()): string {
  const p = artParts(now);
  const noonUtc = Date.UTC(p.y, p.m - 1, p.day, 15, 0, 0);
  const yesterday = new Date(noonUtc - 24 * 60 * 60 * 1000);
  const yp = artParts(yesterday);
  return dayKeyFromParts(yp.y, yp.m, yp.day);
}

function artDayBounds(dayKey: string): { from: Date; to: Date } {
  return {
    from: new Date(`${dayKey}T00:00:00.000-03:00`),
    to: new Date(`${dayKey}T23:59:59.999-03:00`),
  };
}

function formatDayLabel(dayKey: string): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d!, 15));
  return date.toLocaleDateString("es-AR", {
    timeZone: ART,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

async function alreadySentForDay(dayKey: string): Promise<boolean> {
  const row = await prisma.opsServiceHeartbeat.findUnique({
    where: { key: HEARTBEAT_KEY },
    select: { detail: true },
  });
  if (!row?.detail) return false;
  try {
    const parsed = JSON.parse(row.detail) as { lastSentDay?: string };
    return parsed.lastSentDay === dayKey;
  } catch {
    return row.detail === dayKey;
  }
}

async function markSentForDay(dayKey: string, emailed: boolean, count: number): Promise<void> {
  const detail = JSON.stringify({
    lastSentDay: dayKey,
    emailed,
    count,
    at: new Date().toISOString(),
  });
  await prisma.opsServiceHeartbeat.upsert({
    where: { key: HEARTBEAT_KEY },
    create: {
      key: HEARTBEAT_KEY,
      status: "ok",
      healthy: true,
      detail,
      lastEventAt: new Date(),
    },
    update: {
      status: "ok",
      healthy: true,
      detail,
      lastEventAt: new Date(),
    },
  });
}

export type ServiceFeedbackDailyResult = {
  dayKey: string;
  skipped: boolean;
  reason?: string;
  emailed: boolean;
  count: number;
  avgScore: number | null;
};

/**
 * Envía el resumen del día ART anterior (si aún no se envió).
 * `force` ignora dedupe (útil para prueba manual del cron).
 */
export async function runServiceFeedbackDailySummary(options?: {
  force?: boolean;
  dayKey?: string;
}): Promise<ServiceFeedbackDailyResult> {
  const dayKey = options?.dayKey ?? argentinaYesterdayKey();
  if (!options?.force && (await alreadySentForDay(dayKey))) {
    return { dayKey, skipped: true, reason: "already_sent", emailed: false, count: 0, avgScore: null };
  }

  const { from, to } = artDayBounds(dayKey);
  const { rows, avgScore, countWithScore } = await listServiceFeedback({
    from,
    to,
    limit: 500,
  });

  if (rows.length === 0) {
    await markSentForDay(dayKey, false, 0);
    return { dayKey, skipped: true, reason: "empty", emailed: false, count: 0, avgScore: null };
  }

  const emailed = await sendServiceFeedbackDailySummaryEmail({
    dayLabel: formatDayLabel(dayKey),
    avgScore,
    countWithScore,
    rows: rows.map((r) => ({
      ticketId: r.ticketId,
      ticketCode: r.ticketCode,
      cliente: r.cliente,
      score: r.score,
      comment: r.comment,
    })),
  });

  await markSentForDay(dayKey, emailed, rows.length);
  return { dayKey, skipped: false, emailed, count: rows.length, avgScore };
}

/** ¿Es hora de correr el resumen? Default: 08:00 ART. */
export function isServiceFeedbackDailyHour(now = new Date()): boolean {
  const hourRaw = process.env.WARA_SERVICE_FEEDBACK_DAILY_HOUR?.trim();
  const target = hourRaw != null && hourRaw !== "" ? Number(hourRaw) : 8;
  const hour = Number.isFinite(target) ? Math.min(23, Math.max(0, target)) : 8;
  return artParts(now).hour === hour;
}
