/**
 * Seguimiento por inactividad del cliente tras un mensaje de Atilio:
 * - ~15 min: nudge «¿seguís ahí?»
 * - ~30 min: cierre con mensaje + ticket RESOLVED
 *
 * Reloj desde el último OUTBOUND BOT sustantivo (no cuenta el propio nudge).
 * No actúa si el bot está pausado (asesor) o el último mensaje no es del bot.
 */
import type { MessageDirection, MessageFrom, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import { sendWhatsAppMessage } from "@/lib/builderbot";
import { clearPendingAction } from "@/lib/pendingAction";
import { OPEN_TICKET_THREAD_STATUSES } from "@/lib/ticketThreading";
import { reactivateAtilioAfterTicketClosed } from "@/lib/atilioBotPause";

export const IDLE_NUDGE_KIND = "idle_nudge";
export const IDLE_CLOSE_KIND = "idle_close";

export const IDLE_NUDGE_MESSAGE =
  "¿Seguís ahí? Si todavía necesitás ayuda, respondeme cuando puedas y seguimos con tu consulta.";

export const IDLE_CLOSE_MESSAGE =
  "Como no tuve respuesta, cierro esta consulta por ahora. Cuando quieras, escribime de nuevo y te ayudo.";

const DEFAULT_NUDGE_MS = 15 * 60 * 1000;
const DEFAULT_CLOSE_MS = 30 * 60 * 1000;
const DEFAULT_BATCH = 40;

export type IdleFollowupAction = "nudge" | "close" | "none";

export type IdleMessageSnapshot = {
  direction: MessageDirection;
  from: MessageFrom;
  createdAt: Date;
  autoReplyKind?: string | null;
};

export function isIdleFollowupEnabled(): boolean {
  const raw = process.env.WARA_IDLE_FOLLOWUP_ENABLED?.trim().toLowerCase();
  if (raw === "false" || raw === "0" || raw === "no" || raw === "off") return false;
  return true;
}

export function idleNudgeAfterMs(): number {
  const n = Number(process.env.WARA_IDLE_NUDGE_MS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_NUDGE_MS;
}

export function idleCloseAfterMs(): number {
  const n = Number(process.env.WARA_IDLE_CLOSE_MS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_CLOSE_MS;
}

function kindFromPayload(rawPayload: unknown): string | null {
  if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) return null;
  const kind = (rawPayload as Record<string, unknown>).autoReplyKind;
  return typeof kind === "string" ? kind : null;
}

export function isIdleSystemOutbound(kind: string | null | undefined): boolean {
  return kind === IDLE_NUDGE_KIND || kind === IDLE_CLOSE_KIND;
}

/**
 * Decide nudge/close/none a partir del último mensaje del hilo y del último BOT sustantivo.
 * Pure — testeable sin DB.
 */
export function decideIdleFollowup(params: {
  now: Date;
  botPaused: boolean;
  lastMessage: IdleMessageSnapshot | null;
  lastSubstantiveBotAt: Date | null;
  idleNudgeAlreadySent: boolean;
  nudgeAfterMs?: number;
  closeAfterMs?: number;
}): IdleFollowupAction {
  if (params.botPaused) return "none";
  if (!params.lastMessage || !params.lastSubstantiveBotAt) return "none";

  const last = params.lastMessage;
  // Solo si el cliente no habló después del bot: el último del hilo debe ser OUTBOUND BOT.
  if (last.direction !== "OUTBOUND" || last.from !== "BOT") return "none";

  const nudgeMs = params.nudgeAfterMs ?? DEFAULT_NUDGE_MS;
  const closeMs = params.closeAfterMs ?? DEFAULT_CLOSE_MS;
  const waited = params.now.getTime() - params.lastSubstantiveBotAt.getTime();

  if (waited >= closeMs) return "close";
  if (waited >= nudgeMs && !params.idleNudgeAlreadySent) return "nudge";
  return "none";
}

export type IdleFollowupCycleResult = {
  enabled: boolean;
  scanned: number;
  nudged: number;
  closed: number;
  skipped: number;
  errors: number;
};

type CandidateRow = {
  id: string;
  code: string;
  status: string;
  customerId: string;
  customer: { id: string; phone: string; botPausedAt: Date | null };
  messages: Array<{
    direction: MessageDirection;
    from: MessageFrom;
    createdAt: Date;
    rawPayload: unknown;
  }>;
};

export type IdleFollowupDeps = {
  sendWhatsApp: typeof sendWhatsAppMessage;
  clearPending: typeof clearPendingAction;
  reactivateAfterClose: typeof reactivateAtilioAfterTicketClosed;
};

const defaultDeps: IdleFollowupDeps = {
  sendWhatsApp: sendWhatsAppMessage,
  clearPending: clearPendingAction,
  reactivateAfterClose: reactivateAtilioAfterTicketClosed,
};

async function sendAndPersistBotMessage(params: {
  db: PrismaClient;
  ticketId: string;
  phone: string;
  message: string;
  kind: typeof IDLE_NUDGE_KIND | typeof IDLE_CLOSE_KIND;
  now: Date;
  deps: IdleFollowupDeps;
}): Promise<boolean> {
  // Idle es proactivo tras un hilo real: también aplica a teléfonos "protegidos"
  // (el guard de turn solo bloquea envíos sin inbound wamid; acá el chat ya existió).
  try {
    await params.deps.sendWhatsApp({ number: params.phone, message: params.message });
  } catch (err) {
    console.error(
      `[idleFollowup] envío WA falló (${params.kind}):`,
      err instanceof Error ? err.message : err,
    );
    return false;
  }

  await params.db.ticketMessage.create({
    data: {
      ticketId: params.ticketId,
      direction: "OUTBOUND",
      from: "BOT",
      text: params.message,
      rawPayload: {
        autoReply: true,
        autoReplyKind: params.kind,
        source: "idle_conversation_followup",
        waDelivery: "backend_cron",
      },
    },
  });

  await params.db.ticket.update({
    where: { id: params.ticketId },
    data: { lastMessageAt: params.now },
  });

  await params.db.ticketEvent.create({
    data: {
      ticketId: params.ticketId,
      type: "AUTO_REPLY",
      payload: {
        kind: params.kind,
        source: "idle_conversation_followup",
      },
    },
  });

  return true;
}

async function closeTicketForIdle(params: {
  db: PrismaClient;
  ticket: CandidateRow;
  now: Date;
  deps: IdleFollowupDeps;
}): Promise<boolean> {
  const sent = await sendAndPersistBotMessage({
    db: params.db,
    ticketId: params.ticket.id,
    phone: params.ticket.customer.phone,
    message: IDLE_CLOSE_MESSAGE,
    kind: IDLE_CLOSE_KIND,
    now: params.now,
    deps: params.deps,
  });
  if (!sent) return false;

  const previousStatus = params.ticket.status;

  await params.db.ticket.update({
    where: { id: params.ticket.id },
    data: {
      status: "RESOLVED",
      resolution: "IDLE_TIMEOUT",
      resolvedByAI: true,
      aiSummary:
        "Cierre automático por inactividad del cliente (sin respuesta tras mensajes de Atilio).",
      lastMessageAt: params.now,
    },
  });

  await params.db.ticketEvent.create({
    data: {
      ticketId: params.ticket.id,
      type: "STATUS_CHANGED",
      payload: {
        status: "RESOLVED",
        resolution: "IDLE_TIMEOUT",
        source: "idle_conversation_followup",
      },
    },
  });

  await params.deps.clearPending(params.db, params.ticket.customer.phone);

  await params.deps.reactivateAfterClose(
    {
      customerId: params.ticket.customerId,
      ticketId: params.ticket.id,
      previousStatus,
      newStatus: "RESOLVED",
      reason: "idle-timeout-close",
    },
    params.db,
  );

  console.log(`[idleFollowup] cerrado por idle ${params.ticket.code}`);
  return true;
}

/**
 * Un ciclo del cron: escanea tickets abiertos potencialmente idle y actúa.
 */
export async function runIdleConversationFollowupCycle(params?: {
  client?: PrismaClient;
  now?: Date;
  batchSize?: number;
  deps?: Partial<IdleFollowupDeps>;
}): Promise<IdleFollowupCycleResult> {
  const empty: IdleFollowupCycleResult = {
    enabled: false,
    scanned: 0,
    nudged: 0,
    closed: 0,
    skipped: 0,
    errors: 0,
  };
  if (!isIdleFollowupEnabled()) return empty;

  const db = params?.client ?? prisma;
  const now = params?.now ?? new Date();
  const deps: IdleFollowupDeps = { ...defaultDeps, ...params?.deps };
  const nudgeMs = idleNudgeAfterMs();
  const closeMs = idleCloseAfterMs();
  const batch = params?.batchSize ?? DEFAULT_BATCH;
  // Candidatos: última actividad al menos tan vieja como el nudge.
  const staleBefore = new Date(now.getTime() - nudgeMs);

  const tickets = (await db.ticket.findMany({
    where: {
      status: { in: OPEN_TICKET_THREAD_STATUSES },
      lastMessageAt: { lte: staleBefore },
      customer: { botPausedAt: null },
    },
    orderBy: { lastMessageAt: "asc" },
    take: batch,
    include: {
      customer: { select: { id: true, phone: true, botPausedAt: true } },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 12,
        select: {
          direction: true,
          from: true,
          createdAt: true,
          rawPayload: true,
        },
      },
    },
  })) as CandidateRow[];

  const result: IdleFollowupCycleResult = {
    enabled: true,
    scanned: tickets.length,
    nudged: 0,
    closed: 0,
    skipped: 0,
    errors: 0,
  };

  for (const ticket of tickets) {
    try {
      const snaps: IdleMessageSnapshot[] = ticket.messages.map((m) => ({
        direction: m.direction,
        from: m.from,
        createdAt: m.createdAt,
        autoReplyKind: kindFromPayload(m.rawPayload),
      }));
      const lastMessage = snaps[0] ?? null;

      const lastSubstantive = snaps.find(
        (m) =>
          m.direction === "OUTBOUND" &&
          m.from === "BOT" &&
          !isIdleSystemOutbound(m.autoReplyKind),
      );
      const idleNudgeAlreadySent = snaps.some(
        (m) =>
          m.direction === "OUTBOUND" &&
          m.from === "BOT" &&
          m.autoReplyKind === IDLE_NUDGE_KIND,
      );

      const action = decideIdleFollowup({
        now,
        botPaused: Boolean(ticket.customer.botPausedAt),
        lastMessage,
        lastSubstantiveBotAt: lastSubstantive?.createdAt ?? null,
        idleNudgeAlreadySent,
        nudgeAfterMs: nudgeMs,
        closeAfterMs: closeMs,
      });

      if (action === "none") {
        result.skipped += 1;
        continue;
      }

      if (action === "close") {
        const ok = await closeTicketForIdle({ db, ticket, now, deps });
        if (ok) result.closed += 1;
        else result.errors += 1;
        continue;
      }

      // nudge: no reenviar si el último mensaje ya es el nudge
      if (lastMessage?.autoReplyKind === IDLE_NUDGE_KIND) {
        result.skipped += 1;
        continue;
      }

      const ok = await sendAndPersistBotMessage({
        db,
        ticketId: ticket.id,
        phone: ticket.customer.phone,
        message: IDLE_NUDGE_MESSAGE,
        kind: IDLE_NUDGE_KIND,
        now,
        deps,
      });
      if (ok) {
        result.nudged += 1;
        console.log(`[idleFollowup] nudge ${ticket.code}`);
      } else {
        result.errors += 1;
      }
    } catch (err) {
      result.errors += 1;
      console.error(
        `[idleFollowup] error ticket ${ticket.code}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return result;
}

/** Último mensaje del bot en el hilo fue el nudge de inactividad (~15 min). */
export function threadHasRecentIdleNudge(threadText: string): boolean {
  const tail = threadText
    .slice(-2000)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const needle = IDLE_NUDGE_MESSAGE.normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .slice(0, 40);
  return tail.includes(needle);
}

export function buildMetaConversationalContinuityReply(threadText: string): string {
  if (threadHasRecentIdleNudge(threadText)) {
    return (
      "Perfecto, seguimos. Contame qué necesitás: GPS/reporte, odómetro, certificado, " +
      "mantenimiento u otra consulta."
    );
  }
  return "Dale, seguimos. ¿En qué te ayudo?";
}
