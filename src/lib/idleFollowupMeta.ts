/**
 * Meta-conversación tras nudge/cierre idle: detección, contexto y respuestas.
 */
export const IDLE_NUDGE_KIND = "idle_nudge";
export const IDLE_CLOSE_KIND = "idle_close";

export const IDLE_NUDGE_MESSAGE =
  "¿Seguís ahí? Si todavía necesitás ayuda, respondeme cuando puedas y seguimos con tu consulta.";

export const IDLE_CLOSE_MESSAGE =
  "Como no tuve respuesta, cierro esta consulta por ahora. Cuando quieras, escribime de nuevo y te ayudo.";

import type { PendingActionRecord } from "@/lib/pendingAction";
import {
  looksLikeMetaConversationalReply,
  looksLikeOperationalIntent,
} from "@/lib/waraApi";
import { buildInconclusiveTramiteResumePrompt } from "@/lib/tramiteFlowControl";

function normIdleText(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[¡!¿?.,;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normThreadNeedle(message: string): string {
  return message
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .slice(0, 40);
}

const IDLE_CLOSE_NEEDLE = "cierro esta consulta por ahora";
const IDLE_NUDGE_NEEDLE = "seguis ahi";

function hasOperationalPayload(raw: string): boolean {
  return looksLikeOperationalIntent(raw);
}

/** Menú de capacidades del saludo (lista Odómetro/Certificado/GPS/…) — no es tema activo. */
function looksLikeCapabilityMenuSnippet(text: string): boolean {
  const t = normIdleText(text);
  if (!t) return false;
  if (/\ben que te ayudo\b/.test(t) || /\ben que te puedo ayudar\b/.test(t)) return true;
  const bullets = [
    /\bcertificad/,
    /\b(odometro|horometro)/,
    /\b(gps|reporte)\b/,
    /\bmantenim/,
    /\btransporte\s+de\s+pasajer/,
  ].filter((re) => re.test(t)).length;
  return bullets >= 3;
}

/** Últimos mensajes del bot previos al idle, excluyendo menús de capacidades. */
function recentBotContentBeforeIdle(threadText: string): string {
  const pre = threadTextBeforeIdleOutbound(threadText);
  const lines = pre.split("\n");
  const botChunks: string[] = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]?.trim() ?? "";
    if (!/^(Atilio|Kira|BOT|Bot):/i.test(line)) continue;
    const content = line.replace(/^(Atilio|Kira|BOT|Bot):\s*/i, "").trim();
    if (!content) continue;
    if (looksLikeCapabilityMenuSnippet(content)) continue;
    const norm = normIdleText(content);
    if (norm.includes(IDLE_CLOSE_NEEDLE) || norm.includes(IDLE_NUDGE_NEEDLE)) continue;
    botChunks.push(content);
    if (botChunks.join("\n").length > 900 || botChunks.length >= 4) break;
  }
  return botChunks.reverse().join("\n");
}

function looksLikeDeepenGuideCue(raw: string | undefined | null): boolean {
  const t = normIdleText(String(raw ?? ""));
  if (!t || t.length > 160) return false;
  return (
    /\b(contame|cuentame|decime|explica(me)?|amplia(me)?|profundiza)\s+(mas|m[aá]s|un poco)?\b/.test(
      t,
    ) ||
    /\b(mas|m[aá]s)\s+(info|informacion|detalle|detalles)\b/.test(t) ||
    /\bque\s+mas\b/.test(t)
  );
}

/**
 * Tema activo real para retomar tras idle.
 * NUNCA usar el menú de saludo (ahí aparece «Certificado» y ensucia el hint).
 */
function inferIdleTopicHint(threadText: string): string | null {
  const recent = normIdleText(recentBotContentBeforeIdle(threadText));
  if (!recent) return null;

  // Guías informativas (prioridad: lo último que el bot explicó).
  if (
    /\btransporte\s+de\s+pasajer/.test(recent) ||
    /\bhoja(s)?\s+de\s+turno\b/.test(recent) ||
    (/\b(servicio|paradas?|turnos?|poi|gtfs|recorrido)\b/.test(recent) &&
      /\b(transporte|pasajer|linea|l[ií]nea)\b/.test(recent))
  ) {
    return "Seguimos con Transporte de pasajeros. Decime qué punto querés: conceptos, hoja de turno, paradas, servicios o el error que ves.";
  }
  if (/\bhojas?\s+de\s+ruta\b/.test(recent) || /utilidades\s*[→>\-]\s*hojas de ruta/.test(recent)) {
    return "Seguimos con Hojas de ruta. Decime qué punto querés: alta, predefinidas, puntos, calendario o cargas/descargas.";
  }
  if (
    /\bcisternas?\b/.test(recent) ||
    (/\btanque\b/.test(recent) && /\b(deposito|dep[oó]sito|base)\b/.test(recent))
  ) {
    return "Seguimos con Cisternas. Decime si necesitás alta, carga, medición o informes.";
  }
  if (
    /\b(tickets?\s+de\s+combustible|panel(es)?\s*[→>]?\s*combustible|validaci[oó]n de cargas)\b/.test(
      recent,
    )
  ) {
    return "Seguimos con Combustible. Decime si es tickets, validación, panel o informes.";
  }
  if (
    /\bmantenim\w*\b/.test(recent) &&
    /\b(utilidades|plan|preventiv|correctiv|tarea|paso a paso|como\s+(cargar|agendar|programar))\b/.test(
      recent,
    )
  ) {
    return "Seguimos con la guía de Mantenimiento. Decime qué punto querés profundizar.";
  }

  // Trámites: solo si el bot pidió dato / está en flujo (no por palabra suelta del menú).
  if (
    /\bcertificad\w*\b/.test(recent) &&
    /\b(patente|unidad|cobertura|pasame|necesito|emit|constancia)\b/.test(recent)
  ) {
    return "Seguimos con el certificado. Pasame la patente o unidad.";
  }
  if (
    /\b(odometro|horometro)\b/.test(recent) &&
    /\b(patente|unidad|kilometr|hora|pasame|necesito|lectura|fecha)\b/.test(recent)
  ) {
    return "Seguimos con el odómetro/horómetro. Decime la unidad o el dato que faltaba.";
  }
  if (
    /\bmantenim\w*\b/.test(recent) &&
    /\b(patente|unidad|preventiv|correctiv|pasame|necesito)\b/.test(recent)
  ) {
    return "Seguimos con el mantenimiento. Decime la patente y si es preventivo o correctivo.";
  }
  if (
    /\b(gps|reporte|ubicacion|posicion)\b/.test(recent) &&
    /\b(patente|unidad|estado|pasame|necesito|flota)\b/.test(recent)
  ) {
    return "Seguimos con la consulta de unidad/GPS. Contame la patente o qué necesitás revisar.";
  }

  return null;
}

export function formatIdleMetaCustomerPrefix(firstName?: string | null): string {
  const first = String(firstName ?? "").trim();
  if (!first || first.toLowerCase() === "undefined") return "";
  return `${first}, `;
}

/** Solo el texto: reclamo por cierre/nudge idle (variantes y typos). */
export function looksLikeIdleFollowupPushbackCandidate(
  text: string | undefined | null,
): boolean {
  const raw = String(text ?? "").trim();
  if (!raw || raw.length > 180) return false;
  if (hasOperationalPayload(raw)) return false;

  const t = normIdleText(raw);
  if (!t) return false;

  const mentionsResponse =
    /\b(respuesta|respond\w*|contest\w*|escrib\w*|obtuv\w*|tuve|recib\w*|vist\w*)\b/.test(t);
  const mentionsClose = /\bcerr\w*\b/.test(t);

  if (/\bcomo\s*q(u[eé]|e|ke)?\s+no\b/.test(t) || /\bcomo\s+q\s+no\b/.test(t)) return true;
  if (/\bcomo\s+que\b/.test(t) && /\b(no|sin)\b/.test(t) && mentionsResponse) return true;

  if (/\b(pero\s+)?(si|sip|sii|yo)\b/.test(t) && mentionsResponse) return true;
  if (/^(pero\s+)?(si|yo)\s+(respond\w*|contest\w*|escrib\w*)[\s!?.]*$/.test(t)) return true;
  if (/^(te|ya\s+te)\s+(respond\w*|contest\w*|escrib\w*)[\s!?.]*$/.test(t)) return true;

  if (/\bno\s+me\s+cier\w*/.test(t) || /\bno\s+cerr\w*\b/.test(t)) return true;
  if (mentionsClose && mentionsResponse) return true;
  if (/\bme\s+cerr\w*\b/.test(t)) return true;

  if (/\b(que|q)\s+quer\w*\s+decir\b/.test(t) && /\bno\b/.test(t)) return true;
  if (/\bpor\s*q(u[eé]|e)\s+(decis|dec[ií]s|dijiste)\b/.test(t)) return true;
  if (/\bno\s+(es\s+)?cierto\b/.test(t) && mentionsResponse) return true;
  if (/\bno\s+tuve\s+respuesta\b/.test(t) || (/\bsin\s+respuesta\b/.test(t) && mentionsClose)) {
    return true;
  }

  return false;
}

/** Último outbound BOT en el hilo (ignorando líneas Cliente). */
export function threadLastBotOutboundLine(threadText: string): string | null {
  const lines = threadText.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]?.trim() ?? "";
    if (!line) continue;
    if (/^Cliente:/i.test(line)) continue;
    if (/^(Atilio|Kira|BOT|Bot):/i.test(line)) {
      return line.replace(/^(Atilio|Kira|BOT|Bot):\s*/i, "").trim();
    }
  }
  return null;
}

export function threadLastBotOutboundWasIdleClose(threadText: string): boolean {
  const last = threadLastBotOutboundLine(threadText);
  if (!last) return false;
  const norm = normIdleText(last);
  return norm.includes(IDLE_CLOSE_NEEDLE);
}

export function threadLastBotOutboundWasIdleNudge(threadText: string): boolean {
  const last = threadLastBotOutboundLine(threadText);
  if (!last) return false;
  const norm = normIdleText(last);
  return norm.includes(IDLE_NUDGE_NEEDLE);
}

/** Reclamo idle: solo si el último mensaje del bot fue el cierre automático. */
export function shouldHandleIdleFollowupPushback(
  text: string | undefined | null,
  threadText: string,
): boolean {
  if (!looksLikeIdleFollowupPushbackCandidate(text)) return false;
  return threadLastBotOutboundWasIdleClose(threadText);
}

/** Hilo operativo previo al último nudge/cierre idle (para retomar tema). */
export function threadTextBeforeIdleOutbound(threadText: string): string {
  const lines = threadText.split("\n");
  let cutAt = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]?.trim() ?? "";
    if (!/^(Atilio|Kira|BOT|Bot):/i.test(line)) continue;
    const content = normIdleText(line.replace(/^(Atilio|Kira|BOT|Bot):\s*/i, ""));
    if (content.includes(IDLE_CLOSE_NEEDLE) || content.includes(IDLE_NUDGE_NEEDLE)) {
      cutAt = i;
      break;
    }
  }
  if (cutAt <= 0) return threadText;
  return lines.slice(0, cutAt).join("\n");
}

function formatContinuityStep(
  threadText: string,
  pendingAction?: PendingActionRecord | null,
  selectionText?: string | null,
): string {
  const preIdle = threadTextBeforeIdleOutbound(threadText);
  const resume = buildInconclusiveTramiteResumePrompt(
    preIdle.trim() ? preIdle : threadText,
    pendingAction,
  );
  const normalized = resume
    .replace(/^¿Seguimos\?\s*/i, "")
    .replace(/^¿Seguimos con/i, "Seguimos con")
    .replace(/^¿Seguimos/i, "Seguimos");

  // Sin trámite activo: retomar guía/tema real del hilo (nunca el menú de saludo).
  if (/Seguimos con lo que estábamos haciendo/.test(normalized)) {
    const topic = inferIdleTopicHint(threadText);
    if (topic) return topic;
    if (looksLikeDeepenGuideCue(selectionText)) {
      return "Contame qué punto querés que profundice de lo que estábamos viendo.";
    }
    return "¿En qué seguimos? Contame qué necesitás.";
  }
  return normalized;
}

const IDLE_PUSHBACK_APOLOGY =
  "Tenés razón en reclamarlo. Ese cierre fue automático por inactividad y pudo quedar fuera de contexto. Perdón la confusión.";

/** "Si"/"dale" tras nudge idle = sigo acá, no CONFIRMO ni replay de GPS/unidad activa. */
export function looksLikeIdleNudgeAffirmation(
  text: string | undefined | null,
  threadText: string,
): boolean {
  if (!threadLastBotOutboundWasIdleNudge(threadText)) return false;
  const raw = String(text ?? "").trim();
  if (!raw || raw.length > 48) return false;
  if (hasOperationalPayload(raw)) return false;
  const t = normIdleText(raw);
  return /^(si|sip|sii|dale|ok|okey|okay|bueno|perfecto|listo|aca estoy|aqui estoy|presente|seguimos|sigamos)[\s!.,]*$/.test(
    t,
  );
}

export function buildIdleNudgeAffirmationReply(opts?: {
  customerFirstName?: string | null;
}): string {
  const prefix = formatIdleMetaCustomerPrefix(opts?.customerFirstName);
  return `${prefix}Perfecto, seguimos. ¿En qué te puedo ayudar?`;
}

export function buildIdleFollowupPushbackReply(params: {
  threadText: string;
  customerFirstName?: string | null;
  pendingAction?: PendingActionRecord | null;
}): string {
  const prefix = formatIdleMetaCustomerPrefix(params.customerFirstName);
  const step = formatContinuityStep(params.threadText, params.pendingAction);
  return `${prefix}${IDLE_PUSHBACK_APOLOGY} ${step}`;
}

export function buildMetaConversationalContinuityReply(
  threadText: string,
  opts?: {
    customerFirstName?: string | null;
    pendingAction?: PendingActionRecord | null;
    selectionText?: string | null;
  },
): string {
  const prefix = formatIdleMetaCustomerPrefix(opts?.customerFirstName);
  const step = formatContinuityStep(
    threadText,
    opts?.pendingAction,
    opts?.selectionText,
  );

  if (threadLastBotOutboundWasIdleClose(threadText)) {
    return `${prefix}${step}`;
  }
  if (threadLastBotOutboundWasIdleNudge(threadText)) {
    return `${prefix}${/^Seguimos/i.test(step) ? `Perfecto, ${step}` : `Perfecto, seguimos. ${step}`}`;
  }
  if (step && !/^Seguimos con lo que/.test(step) && !/^¿En qué seguimos/i.test(step)) {
    return `${prefix}${/^Seguimos/i.test(step) ? `Dale, ${step}` : `Dale, seguimos. ${step}`}`;
  }
  return `${prefix}Dale, seguimos. ¿En qué te ayudo?`;
}

export type IdleFollowupMetaTurnResult = {
  intercept: true;
  idlePushback: boolean;
  message: string;
};

/**
 * Punto único para executor/BBC: meta-conversacional + pushback idle acotado.
 * No incluye pending CONFIRMO (el caller lo resuelve antes).
 */
export function resolveIdleFollowupMetaTurn(params: {
  selectionText: string;
  threadText: string;
  customerFirstName?: string | null;
  pendingAction?: PendingActionRecord | null;
}): IdleFollowupMetaTurnResult | null {
  const { selectionText, threadText, customerFirstName, pendingAction } = params;

  if (shouldHandleIdleFollowupPushback(selectionText, threadText)) {
    return {
      intercept: true,
      idlePushback: true,
      message: buildIdleFollowupPushbackReply({
        threadText,
        customerFirstName,
        pendingAction,
      }),
    };
  }

  if (looksLikeIdleNudgeAffirmation(selectionText, threadText)) {
    return {
      intercept: true,
      idlePushback: false,
      message: buildIdleNudgeAffirmationReply({ customerFirstName }),
    };
  }

  if (looksLikeMetaConversationalReply(selectionText)) {
    return {
      intercept: true,
      idlePushback: false,
      message: buildMetaConversationalContinuityReply(threadText, {
        customerFirstName,
        pendingAction,
        selectionText,
      }),
    };
  }

  return null;
}
