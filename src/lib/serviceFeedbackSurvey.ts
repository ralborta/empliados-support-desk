/**
 * Encuesta de satisfacción por link (Ola 2).
 * Un mensaje al cierre elegible → mini-página /s/{token}.
 * No reabre el hilo operativo como captura 1–10 en chat.
 */
import { randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import { sendAutomaticBotTextWithOptionalMedia } from "@/lib/automaticBotDeliveryGate";

const SURVEY_KIND = "service_feedback_survey";
const SURVEY_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export type SurveyPayload = {
  kind: typeof SURVEY_KIND;
  token: string;
  ticketId: string;
  stage: "pending" | "completed" | "expired";
  resolved?: boolean | null;
  score?: number | null;
  comment?: string | null;
  createdAt?: string;
  completedAt?: string;
};

function panelBaseUrl(): string {
  return (
    process.env.PANEL_BASE_URL?.trim() ||
    process.env.WARA_TURN_BASE_URL?.trim() ||
    "https://wara.nivel41.com"
  ).replace(/\/$/, "");
}

export function isServiceFeedbackLinkEnabled(): boolean {
  const raw = process.env.WARA_SERVICE_FEEDBACK_LINK?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false;
  // Default ON: Ola 2 reemplaza la captura en chat al cierre.
  return true;
}

function isSurveyPayload(v: unknown): v is SurveyPayload {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const p = v as Record<string, unknown>;
  return (
    p.kind === SURVEY_KIND &&
    typeof p.token === "string" &&
    typeof p.ticketId === "string" &&
    (p.stage === "pending" || p.stage === "completed" || p.stage === "expired")
  );
}

export function buildSurveyUrl(token: string): string {
  return `${panelBaseUrl()}/s/${encodeURIComponent(token)}`;
}

export function buildSurveyOfferMessage(token: string): string {
  const url = buildSurveyUrl(token);
  return (
    "Antes de irte, ¿nos dejás 20 segundos de feedback?\n" +
    `Abrí el link (no hace falta responder acá):\n${url}`
  );
}

async function findSurveyEventByToken(
  token: string,
  client: PrismaClient,
): Promise<{ eventId: string; ticketId: string; payload: SurveyPayload } | null> {
  const since = new Date(Date.now() - SURVEY_TTL_MS);
  const events = await client.ticketEvent.findMany({
    where: {
      createdAt: { gte: since },
      type: "AUTO_REPLY",
    },
    orderBy: { createdAt: "desc" },
    take: 80,
    select: { id: true, ticketId: true, payload: true, createdAt: true },
  });
  for (const ev of events) {
    if (!isSurveyPayload(ev.payload)) continue;
    if (ev.payload.token !== token) continue;
    const age = Date.now() - ev.createdAt.getTime();
    if (age > SURVEY_TTL_MS && ev.payload.stage === "pending") {
      return {
        eventId: ev.id,
        ticketId: ev.ticketId,
        payload: { ...ev.payload, stage: "expired" },
      };
    }
    return { eventId: ev.id, ticketId: ev.ticketId, payload: ev.payload };
  }
  return null;
}

async function ticketAlreadyHasSurveyOffer(
  ticketId: string,
  client: PrismaClient,
): Promise<boolean> {
  const since = new Date(Date.now() - SURVEY_TTL_MS);
  const events = await client.ticketEvent.findMany({
    where: { ticketId, createdAt: { gte: since }, type: "AUTO_REPLY" },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { payload: true },
  });
  return events.some((ev) => isSurveyPayload(ev.payload));
}

/**
 * Crea token + evento y envía el link una sola vez por ticket.
 * No envía si el bot está en pausa humana (gate de delivery).
 */
export async function offerServiceFeedbackSurveyOnClose(params: {
  ticketId: string;
  customerPhone: string;
  source: string;
  client?: PrismaClient;
}): Promise<{ offered: boolean; token?: string; reason?: string }> {
  if (!isServiceFeedbackLinkEnabled()) {
    return { offered: false, reason: "link_disabled" };
  }
  const db = params.client ?? prisma;
  if (await ticketAlreadyHasSurveyOffer(params.ticketId, db)) {
    return { offered: false, reason: "already_offered" };
  }

  const token = randomBytes(18).toString("base64url");
  const payload: SurveyPayload = {
    kind: SURVEY_KIND,
    token,
    ticketId: params.ticketId,
    stage: "pending",
    createdAt: new Date().toISOString(),
  };

  await db.ticketEvent.create({
    data: {
      ticketId: params.ticketId,
      type: "AUTO_REPLY",
      payload: { ...payload, source: params.source },
    },
  });

  const message = buildSurveyOfferMessage(token);
  const send = await sendAutomaticBotTextWithOptionalMedia({
    number: params.customerPhone,
    message,
    source: `service_feedback_survey:${params.source}`,
  });

  if ("skipped" in send && send.skipped) {
    console.log(
      `[survey] link creado pero WA omitido (${send.reason}) ticket=${params.ticketId}`,
    );
    return { offered: true, token, reason: "created_wa_skipped" };
  }

  await db.ticketMessage.create({
    data: {
      ticketId: params.ticketId,
      direction: "OUTBOUND",
      from: "BOT",
      text: message,
      rawPayload: { kind: SURVEY_KIND, token, source: params.source },
    },
  });

  return { offered: true, token };
}

export async function getSurveyByToken(token: string, client: PrismaClient = prisma) {
  const found = await findSurveyEventByToken(token.trim(), client);
  if (!found) return null;
  const ticket = await client.ticket.findUnique({
    where: { id: found.ticketId },
    select: { id: true, code: true, status: true },
  });
  return { ...found, ticket };
}

export async function submitSurveyByToken(params: {
  token: string;
  resolved: boolean | null;
  score: number | null;
  comment: string | null;
  client?: PrismaClient;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const db = params.client ?? prisma;
  const found = await findSurveyEventByToken(params.token.trim(), db);
  if (!found) return { ok: false, error: "not_found" };
  if (found.payload.stage === "expired") return { ok: false, error: "expired" };
  if (found.payload.stage === "completed") return { ok: false, error: "already_completed" };

  const score =
    typeof params.score === "number" &&
    Number.isInteger(params.score) &&
    params.score >= 1 &&
    params.score <= 10
      ? params.score
      : null;

  await db.ticketEvent.create({
    data: {
      ticketId: found.ticketId,
      type: "AUTO_REPLY",
      payload: {
        kind: "service_feedback",
        stage: "recorded",
        ticketId: found.ticketId,
        score,
        comment: params.comment?.trim().slice(0, 800) || null,
        resolved: params.resolved,
        via: "survey_link",
        token: found.payload.token,
      },
    },
  });

  await db.ticketEvent.create({
    data: {
      ticketId: found.ticketId,
      type: "AUTO_REPLY",
      payload: {
        ...found.payload,
        stage: "completed",
        resolved: params.resolved,
        score,
        comment: params.comment?.trim().slice(0, 800) || null,
        completedAt: new Date().toISOString(),
      } satisfies SurveyPayload,
    },
  });

  return { ok: true };
}

/** Marca evidencia de trámite exitoso (GPS/odómetro/etc.) sin pedir nota en chat. */
export async function markTramiteSuccessEvidence(params: {
  ticketId: string;
  tramite: string;
  client?: PrismaClient;
}): Promise<void> {
  const db = params.client ?? prisma;
  await db.ticketEvent.create({
    data: {
      ticketId: params.ticketId,
      type: "AUTO_REPLY",
      payload: {
        kind: "tramite_success",
        tramite: params.tramite,
        at: new Date().toISOString(),
      },
    },
  });
}
