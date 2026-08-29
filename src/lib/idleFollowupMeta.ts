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

function inferIdleTopicHint(threadText: string): string | null {
  const pre = normIdleText(threadTextBeforeIdleOutbound(threadText));
  if (/\bcertificad\w*\b/.test(pre)) {
    return "Seguimos con el certificado. Pasame la patente o unidad.";
  }
  if (/\b(odometro|horometro|kilometr\w*|horas?\s+de\s+lectura)\b/.test(pre)) {
    return "Seguimos con el odómetro/horómetro. Decime la unidad o el dato que faltaba.";
  }
  if (/\bmantenim\w*\b/.test(pre)) {
    return "Seguimos con el mantenimiento. Decime la patente y si es preventivo o correctivo.";
  }
  if (/\b(gps|reporte|ubicacion|posicion|flota|unidad)\b/.test(pre)) {
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
    if (/^(Atilio|BOT|Bot):/i.test(line)) {
      return line.replace(/^(Atilio|BOT|Bot):\s*/i, "").trim();
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
    if (!/^(Atilio|BOT|Bot):/i.test(line)) continue;
    const content = normIdleText(line.replace(/^(Atilio|BOT|Bot):\s*/i, ""));
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
  if (/Seguimos con lo que estábamos haciendo/.test(normalized)) {
    return inferIdleTopicHint(threadText) ?? normalized;
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
  opts?: { customerFirstName?: string | null; pendingAction?: PendingActionRecord | null },
): string {
  const prefix = formatIdleMetaCustomerPrefix(opts?.customerFirstName);
  const step = formatContinuityStep(threadText, opts?.pendingAction);

  if (threadLastBotOutboundWasIdleClose(threadText)) {
    return `${prefix}${step}`;
  }
  if (threadLastBotOutboundWasIdleNudge(threadText)) {
    return `${prefix}${/^Seguimos/i.test(step) ? `Perfecto, ${step}` : `Perfecto, seguimos. ${step}`}`;
  }
  if (step && !/^Seguimos con lo que/.test(step)) {
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
      }),
    };
  }

  return null;
}
