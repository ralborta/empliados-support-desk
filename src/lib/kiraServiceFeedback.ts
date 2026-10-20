import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import { looksLikeGreeting } from "@/lib/waraApi";
import { looksLikeCustomerConversationCloseRequest } from "@/lib/customerConversationCloseDetect";
import { findCustomerByWhatsAppNumber } from "@/lib/whatsappPhone";
import { OPEN_TICKET_THREAD_STATUSES } from "@/lib/ticketThreading";

/** Opt-out: WARA_SERVICE_FEEDBACK_ENABLED=false */
export function isKiraServiceFeedbackEnabled(): boolean {
  const raw = process.env.WARA_SERVICE_FEEDBACK_ENABLED?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false;
  return true;
}

const FEEDBACK_TTL_MS = 24 * 60 * 60 * 1000;

/** Pedido de nota 1–10 tras resolver un trámite (no al cerrar la charla). */
export function buildServiceFeedbackScoreAsk(): string {
  return "Del *1 al 10*, ¿qué tan bien te sirvió la ayuda de hoy?";
}

/** @deprecated Preferí appendServiceFeedbackAskAfterTramiteSuccess en éxitos operativos. */
export function buildCloseMessageWithFeedbackAsk(): string {
  return (
    "Listo, cerré tu consulta. Gracias por escribirnos.\n\n" +
    buildServiceFeedbackScoreAsk()
  );
}

/**
 * Tras resolver un tema (GPS, odómetro, certificado, mantenimiento): pega la nota
 * 1–10 al mensaje de respuesta y deja la encuesta pendiente. Cada acción resuelta
 * pide la nota (si ya hay una esperando respuesta, no apila otra). No actúa en cierres.
 */
export async function appendServiceFeedbackAskAfterTramiteSuccess(params: {
  message: string;
  rawPhone: string;
  ticketId?: string | null;
  client?: PrismaClient;
}): Promise<string> {
  const base = params.message.trim();
  if (!base || !isKiraServiceFeedbackEnabled()) return params.message;

  const db = params.client ?? prisma;
  const customer = await findCustomerByWhatsAppNumber(db, params.rawPhone);
  if (!customer) return params.message;

  const pending = await findOpenFeedbackPending(customer.id, db);
  if (pending) return params.message;

  let ticketId = params.ticketId?.trim() || null;
  if (!ticketId) {
    const open = await db.ticket.findFirst({
      where: { customerId: customer.id, status: { in: OPEN_TICKET_THREAD_STATUSES } },
      orderBy: { lastMessageAt: "desc" },
      select: { id: true },
    });
    ticketId =
      open?.id ??
      (
        await db.ticket.findFirst({
          where: { customerId: customer.id },
          orderBy: { lastMessageAt: "desc" },
          select: { id: true },
        })
      )?.id ??
      null;
  }
  if (!ticketId) return params.message;

  await markServiceFeedbackAwaitingScore(ticketId, db);
  return `${base}\n\n${buildServiceFeedbackScoreAsk()}`;
}

export function buildFeedbackCommentAsk(score: number): string {
  if (score >= 8) {
    return (
      `Buenisimo, anoté un *${score}*. ` +
      "Si se te ocurre algo para sumar o sacar de lo que hago, tirame una frase " +
      "(o respondé *listo* y listo)."
    );
  }
  if (score >= 5) {
    return (
      `Gracias, quedó en *${score}*. ` +
      "¿Qué cambiarías o qué te faltó? Una frase alcanza " +
      "(o *listo* si preferís no decir nada)."
    );
  }
  return (
    `Gracias por la franqueza (*${score}*). ` +
    "Contame qué falló o qué sumarías — nos sirve " +
    "(o *listo* si no querés ampliar)."
  );
}

export function buildFeedbackThanksAfterComment(): string {
  return "Gracias, lo tengo. Cualquier cosa, acá estamos.";
}

export function buildFeedbackThanksSkipComment(): string {
  return "Dale, gracias igual. Cualquier cosa, escribime.";
}

export function parseServiceFeedbackScore(text: string | undefined | null): number | null {
  const t = String(text ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
  if (!t || t.length > 40) return null;

  const bare = t.match(/^(10|[1-9])([!.]?)$/);
  if (bare) return Number(bare[1]);

  const withLabel = t.match(
    /^(nota|puntaje|puntos?|calificaci[oó]n|score)?\s*(?:de\s+|es\s+|:\s*)?(10|[1-9])\b/,
  );
  if (withLabel) return Number(withLabel[2]);

  const outOf = t.match(/\b(10|[1-9])\s*(?:\/\s*10|de\s*10)\b/);
  if (outOf) return Number(outOf[1]);

  return null;
}

export function looksLikeFeedbackSkip(text: string | undefined | null): boolean {
  const t = String(text ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
  if (!t) return true;
  return /^(listo|ok|oka|okey|no|nop|nah|nada|gracias|than(k|ks)|bye|chau|fin|-|\.|skip)$/.test(
    t,
  );
}

/** Si parece un pedido operativo nuevo, abortamos la encuesta. */
export function looksLikeFeedbackAbortToOps(text: string | undefined | null): boolean {
  const t = String(text ?? "").trim();
  if (!t) return false;
  if (parseServiceFeedbackScore(t) != null) return false;
  if (looksLikeFeedbackSkip(t)) return false;
  if (looksLikeGreeting(t)) return true;
  if (looksLikeCustomerConversationCloseRequest(t)) return true;
  if (t.length > 80) return true;
  if (
    /\b(odometro|horometro|certificado|patente|unidad|gps|mantenimiento|asesor|ticket|caso|reporta|reporte|posicion|ubicacion|señal|senal)\b/i.test(
      t,
    )
  ) {
    return true;
  }
  // Código interno de unidad ("900-014", "600182") o patente suelta ("AI 391 SJ"):
  // es una consulta nueva, no la nota. Bug real 2026-10-20: "900-014" con encuesta
  // pendiente recibía "Con un número del 1 al 10…" en vez del estado GPS.
  const norm = t
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
  if (/^\d{3,4}[-\s]?\d{3}$/.test(norm)) return true;
  if (/^[A-Z]{2,3}\s?\d{3}\s?[A-Z]{0,2}$/.test(norm)) return true;
  return false;
}

type FeedbackStage = "awaiting_score" | "awaiting_comment";

type FeedbackPendingPayload = {
  kind: "service_feedback";
  stage: FeedbackStage;
  ticketId: string;
  score?: number;
};

function isFeedbackPayload(v: unknown): v is FeedbackPendingPayload {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const p = v as Record<string, unknown>;
  return (
    p.kind === "service_feedback" &&
    (p.stage === "awaiting_score" || p.stage === "awaiting_comment") &&
    typeof p.ticketId === "string"
  );
}

export async function markServiceFeedbackAwaitingScore(
  ticketId: string,
  client: PrismaClient = prisma,
): Promise<void> {
  if (!isKiraServiceFeedbackEnabled()) return;
  await client.ticketEvent.create({
    data: {
      ticketId,
      type: "AUTO_REPLY",
      payload: {
        kind: "service_feedback",
        stage: "awaiting_score",
        ticketId,
      } satisfies FeedbackPendingPayload,
    },
  });
}

async function findOpenFeedbackPending(
  customerId: string,
  client: PrismaClient,
): Promise<{ eventId: string; ticketId: string; payload: FeedbackPendingPayload } | null> {
  const since = new Date(Date.now() - FEEDBACK_TTL_MS);
  const events = await client.ticketEvent.findMany({
    where: {
      createdAt: { gte: since },
      type: "AUTO_REPLY",
      ticket: { customerId },
    },
    orderBy: { createdAt: "desc" },
    take: 12,
    select: { id: true, ticketId: true, payload: true },
  });

  for (const ev of events) {
    if (!ev.payload || typeof ev.payload !== "object" || Array.isArray(ev.payload)) continue;
    const p = ev.payload as Record<string, unknown>;
    if (p.kind !== "service_feedback") continue;
    const stage = String(p.stage ?? "");
    if (stage === "recorded" || stage === "skipped" || stage === "aborted") {
      return null;
    }
    if (isFeedbackPayload(ev.payload)) {
      return { eventId: ev.id, ticketId: ev.ticketId, payload: ev.payload };
    }
  }
  return null;
}

async function appendFeedbackEvent(
  ticketId: string,
  payload: Record<string, unknown>,
  client: PrismaClient,
): Promise<void> {
  await client.ticketEvent.create({
    data: {
      ticketId,
      type: "AUTO_REPLY",
      payload: { kind: "service_feedback", ...payload },
    },
  });
}

export type ServiceFeedbackTurnResult =
  | { handled: false }
  | { handled: true; replyMessage: string; outcome: "score" | "comment" | "skip" | "aborted" };

/**
 * Si hay encuesta abierta para el cliente, consume el mensaje y responde.
 * No pide I/O de WhatsApp: el caller envía `replyMessage`.
 */
export async function tryHandleKiraServiceFeedback(params: {
  rawPhone: string;
  messageText: string;
  client?: PrismaClient;
}): Promise<ServiceFeedbackTurnResult> {
  if (!isKiraServiceFeedbackEnabled()) return { handled: false };

  const db = params.client ?? prisma;
  const customer = await findCustomerByWhatsAppNumber(db, params.rawPhone);
  if (!customer) return { handled: false };

  const pending = await findOpenFeedbackPending(customer.id, db);
  if (!pending) return { handled: false };

  const text = params.messageText.trim();

  if (looksLikeFeedbackAbortToOps(text) && pending.payload.stage === "awaiting_score") {
    // Score pending + mensaje operativo: soltamos la encuesta y dejamos seguir el router.
    await appendFeedbackEvent(
      pending.ticketId,
      { stage: "aborted", reason: "ops_intent", priorStage: pending.payload.stage },
      db,
    );
    return { handled: false };
  }

  if (pending.payload.stage === "awaiting_score") {
    const score = parseServiceFeedbackScore(text);
    if (score == null) {
      if (looksLikeFeedbackSkip(text)) {
        await appendFeedbackEvent(
          pending.ticketId,
          { stage: "skipped", reason: "skip_score" },
          db,
        );
        return {
          handled: true,
          replyMessage: buildFeedbackThanksSkipComment(),
          outcome: "skip",
        };
      }
      // Re-pregunta suave sin sonar a formulario.
      return {
        handled: true,
        replyMessage: "Con un número del *1 al 10* me alcanza (o *listo* si preferís saltear).",
        outcome: "score",
      };
    }

    await appendFeedbackEvent(
      pending.ticketId,
      { stage: "awaiting_comment", score, ticketId: pending.ticketId },
      db,
    );
    return {
      handled: true,
      replyMessage: buildFeedbackCommentAsk(score),
      outcome: "score",
    };
  }

  // awaiting_comment
  if (looksLikeFeedbackAbortToOps(text) && !looksLikeFeedbackSkip(text)) {
    await appendFeedbackEvent(
      pending.ticketId,
      {
        stage: "recorded",
        score: pending.payload.score ?? null,
        comment: null,
        reason: "ops_intent_after_score",
      },
      db,
    );
    return { handled: false };
  }

  if (looksLikeFeedbackSkip(text)) {
    await appendFeedbackEvent(
      pending.ticketId,
      {
        stage: "recorded",
        score: pending.payload.score ?? null,
        comment: null,
        skippedComment: true,
      },
      db,
    );
    return {
      handled: true,
      replyMessage: buildFeedbackThanksSkipComment(),
      outcome: "skip",
    };
  }

  const comment = text.slice(0, 800);
  await appendFeedbackEvent(
    pending.ticketId,
    {
      stage: "recorded",
      score: pending.payload.score ?? null,
      comment,
    },
    db,
  );
  return {
    handled: true,
    replyMessage: buildFeedbackThanksAfterComment(),
    outcome: "comment",
  };
}
