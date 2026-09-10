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
import type { LastInfoGuideKind } from "@/lib/lastInfoGuideContext";
import { isLastInfoGuideKind } from "@/lib/lastInfoGuideContext";
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

/** Tema de guía / trámite inferido del hilo (fallback si no hay metadato estructurado). */
export type IdleTopicKind =
  | LastInfoGuideKind
  | "certificados"
  | "odometro"
  | "gps_unidad";

function inferIdleTopicKindFromThread(threadText: string): IdleTopicKind | null {
  const recent = normIdleText(recentBotContentBeforeIdle(threadText));
  if (!recent) return null;

  if (
    /\btransporte\s+de\s+pasajer/.test(recent) ||
    /\bhoja(s)?\s+de\s+turno\b/.test(recent) ||
    (/\b(servicio|paradas?|turnos?|poi|gtfs|recorrido)\b/.test(recent) &&
      /\b(transporte|pasajer|linea|l[ií]nea)\b/.test(recent))
  ) {
    return "transporte_publico";
  }
  if (/\bhojas?\s+de\s+ruta\b/.test(recent) || /utilidades\s*[→>\-]\s*hojas de ruta/.test(recent)) {
    return "hojas_de_ruta";
  }
  if (
    /\bcisternas?\b/.test(recent) ||
    (/\btanque\b/.test(recent) && /\b(deposito|dep[oó]sito|base)\b/.test(recent))
  ) {
    return "cisternas";
  }
  if (
    /\b(tickets?\s+de\s+combustible|panel(es)?\s*[→>]?\s*combustible|validaci[oó]n de cargas)\b/.test(
      recent,
    )
  ) {
    return "combustible";
  }
  if (
    /\bmantenim\w*\b/.test(recent) &&
    /\b(utilidades|plan|preventiv|correctiv|tarea|paso a paso|como\s+(cargar|agendar|programar))\b/.test(
      recent,
    )
  ) {
    return "mantenimiento";
  }

  if (
    /\bcertificad\w*\b/.test(recent) &&
    /\b(patente|unidad|cobertura|pasame|necesito|emit|constancia)\b/.test(recent)
  ) {
    return "certificados";
  }
  if (
    /\b(odometro|horometro)\b/.test(recent) &&
    /\b(patente|unidad|kilometr|hora|pasame|necesito|lectura|fecha)\b/.test(recent)
  ) {
    return "odometro";
  }
  if (
    /\bmantenim\w*\b/.test(recent) &&
    /\b(patente|unidad|preventiv|correctiv|pasame|necesito)\b/.test(recent)
  ) {
    return "mantenimiento";
  }
  if (
    /\b(gps|reporte|ubicacion|posicion)\b/.test(recent) &&
    /\b(patente|unidad|estado|pasame|necesito|flota)\b/.test(recent)
  ) {
    return "gps_unidad";
  }

  return null;
}

/** Resuelve tema: metadato estructurado gana sobre inferencia del hilo. */
export function resolveIdleTopicKind(
  threadText: string,
  lastGuideKind?: LastInfoGuideKind | null,
): IdleTopicKind | null {
  if (lastGuideKind && isLastInfoGuideKind(lastGuideKind)) return lastGuideKind;
  return inferIdleTopicKindFromThread(threadText);
}

function idleTopicLabel(kind: IdleTopicKind): string {
  switch (kind) {
    case "transporte_publico":
      return "Transporte de pasajeros";
    case "hojas_de_ruta":
      return "Hojas de ruta";
    case "cisternas":
      return "Cisternas";
    case "combustible":
      return "Combustible";
    case "mantenimiento":
      return "Mantenimiento";
    case "opciones":
      return "Opciones";
    case "unidades":
      return "Unidades";
    case "certificados":
      return "el certificado";
    case "odometro":
      return "el odómetro/horómetro";
    case "gps_unidad":
      return "la consulta de unidad/GPS";
    default:
      return "lo que estábamos viendo";
  }
}

function idleTopicHint(kind: IdleTopicKind): string {
  switch (kind) {
    case "transporte_publico":
      return "Seguimos con Transporte de pasajeros. Decime qué punto querés: conceptos, hoja de turno, paradas, servicios o el error que ves.";
    case "hojas_de_ruta":
      return "Seguimos con Hojas de ruta. Decime qué punto querés: alta, predefinidas, puntos, calendario o cargas/descargas.";
    case "cisternas":
      return "Seguimos con Cisternas. Decime si necesitás alta, carga, medición o informes.";
    case "combustible":
      return "Seguimos con Combustible. Decime si es tickets, validación, panel o informes.";
    case "mantenimiento":
      return "Seguimos con la guía de Mantenimiento. Decime qué punto querés profundizar.";
    case "opciones":
      return "Seguimos con Opciones. Decime qué querés configurar.";
    case "unidades":
      return "Seguimos con Unidades. Decime qué necesitás revisar.";
    case "certificados":
      return "Seguimos con el certificado. Pasame la patente o unidad.";
    case "odometro":
      return "Seguimos con el odómetro/horómetro. Decime la unidad o el dato que faltaba.";
    case "gps_unidad":
      return "Seguimos con la consulta de unidad/GPS. Contame la patente o qué necesitás revisar.";
    default:
      return "¿En qué seguimos? Contame qué necesitás.";
  }
}

function pendingTramiteLabel(pending?: PendingActionRecord | null): string | null {
  if (!pending?.type) return null;
  if (pending.type === "certificados") return "certificado";
  if (pending.type === "odometro") return "odómetro/horómetro";
  if (pending.type === "mantenimiento") return "mantenimiento";
  return null;
}

/** Guía informativa reciente vs trámite write pendiente residual. */
export function idleGuideConflictsWithPending(
  topic: IdleTopicKind | null,
  pending?: PendingActionRecord | null,
): boolean {
  if (!topic || !pending?.type) return false;
  // Trámites write: si el tema reciente es guía/consulta distinta, no retomar pending en silencio.
  if (topic === "certificados" && pending.type === "certificados") return false;
  if (topic === "odometro" && pending.type === "odometro") return false;
  if (topic === "mantenimiento" && pending.type === "mantenimiento") return false;
  const guideLike =
    topic === "transporte_publico" ||
    topic === "hojas_de_ruta" ||
    topic === "cisternas" ||
    topic === "combustible" ||
    topic === "opciones" ||
    topic === "unidades" ||
    topic === "gps_unidad" ||
    topic === "mantenimiento";
  return guideLike;
}

function buildIdleForkAsk(topic: IdleTopicKind, pendingLabel: string): string {
  const guide = idleTopicLabel(topic);
  return `¿Seguimos con ${guide} o querés retomar el ${pendingLabel} pendiente?`;
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
  lastGuideKind?: LastInfoGuideKind | null,
): string {
  const preIdle = threadTextBeforeIdleOutbound(threadText);
  const scoped = preIdle.trim() ? preIdle : threadText;
  const topic = resolveIdleTopicKind(threadText, lastGuideKind);
  const pendingLabel = pendingTramiteLabel(pendingAction);

  const threadOnlyResume = buildInconclusiveTramiteResumePrompt(scoped, null);
  const threadHasNativeTramite = !/Seguimos con lo que estábamos haciendo/.test(
    threadOnlyResume,
  );

  // Guía reciente + pending residual en DB → preguntar (no retomar certificado en silencio).
  if (
    topic &&
    pendingLabel &&
    idleGuideConflictsWithPending(topic, pendingAction) &&
    !threadHasNativeTramite
  ) {
    return buildIdleForkAsk(topic, pendingLabel);
  }

  // Guía reciente sin trámite nativo en el hilo → retomar guía.
  if (topic && !threadHasNativeTramite && !pendingLabel) {
    return idleTopicHint(topic);
  }

  const resume = buildInconclusiveTramiteResumePrompt(scoped, pendingAction);
  const normalized = resume
    .replace(/^¿Seguimos\?\s*/i, "")
    .replace(/^¿Seguimos con/i, "Seguimos con")
    .replace(/^¿Seguimos/i, "Seguimos");

  if (/Seguimos con lo que estábamos haciendo/.test(normalized)) {
    if (topic) return idleTopicHint(topic);
    const clarify = lastBotClarifyQuestionBeforeIdle(threadText);
    if (clarify) return `Retomemos: ${clarify}`;
    if (looksLikeDeepenGuideCue(selectionText)) {
      return "Contame qué punto querés que profundice de lo que estábamos viendo.";
    }
    return "¿En qué seguimos? Contame qué necesitás.";
  }
  return normalized;
}

/** True cuando el executor NO debe pisar el mensaje meta con resume de pending. */
export function idleMetaShouldPreferGuideOverPending(
  threadText: string,
  pendingAction?: PendingActionRecord | null,
  lastGuideKind?: LastInfoGuideKind | null,
): boolean {
  const topic = resolveIdleTopicKind(threadText, lastGuideKind);
  if (!topic || !pendingTramiteLabel(pendingAction)) return false;
  if (!idleGuideConflictsWithPending(topic, pendingAction)) return false;
  const scoped = threadTextBeforeIdleOutbound(threadText);
  const threadOnly = buildInconclusiveTramiteResumePrompt(
    scoped.trim() ? scoped : threadText,
    null,
  );
  const threadHasNativeTramite = !/Seguimos con lo que estábamos haciendo/.test(threadOnly);
  return !threadHasNativeTramite;
}

const IDLE_PUSHBACK_APOLOGY =
  "Tenés razón en reclamarlo. Ese cierre fue automático por inactividad y pudo quedar fuera de contexto. Perdón la confusión.";

/** "Si"/"dale"/"si, sigo aquí" tras nudge idle = sigo acá, no CONFIRMO ni replay de GPS/unidad activa. */
export function looksLikeIdleNudgeAffirmation(
  text: string | undefined | null,
  threadText: string,
): boolean {
  if (!threadLastBotOutboundWasIdleNudge(threadText)) return false;
  const raw = String(text ?? "").trim();
  if (!raw || raw.length > 64) return false;
  if (hasOperationalPayload(raw)) return false;
  const t = normIdleText(raw);
  if (
    /^(si|sip|sii|dale|ok|okey|okay|bueno|perfecto|listo|aca estoy|aqui estoy|presente|seguimos|sigamos)[\s!.,]*$/.test(
      t,
    )
  ) {
    return true;
  }
  // «Si, sigo aquí» / «sí estoy acá» (bug real: no matcheaba y perdía el tema)
  if (/^(si|sip|dale|ok|bueno)\s+(sigo|estoy)\s+(aca|aqui)\b/.test(t)) return true;
  if (/^(sigo|estoy)\s+(aca|aqui)(\s+(todavia|aun))?[\s!.,]*$/.test(t)) return true;
  return false;
}

export function buildIdleNudgeAffirmationReply(opts?: {
  customerFirstName?: string | null;
}): string {
  const prefix = formatIdleMetaCustomerPrefix(opts?.customerFirstName);
  return `${prefix}Perfecto, seguimos. ¿En qué te puedo ayudar?`;
}

/** Última pregunta/aclaración del bot antes del nudge (para retomar el hilo). */
export function lastBotClarifyQuestionBeforeIdle(threadText: string): string | null {
  const recent = recentBotContentBeforeIdle(threadText);
  if (!recent.trim()) return null;
  const chunks = recent
    .split(/\n+/)
    .map((c) => c.trim())
    .filter(Boolean);
  for (let i = chunks.length - 1; i >= 0; i--) {
    const c = chunks[i]!;
    if (c.length > 280) continue;
    if (/\?\s*$/.test(c)) return c;
  }
  return null;
}

export function buildIdleFollowupPushbackReply(params: {
  threadText: string;
  customerFirstName?: string | null;
  pendingAction?: PendingActionRecord | null;
  lastGuideKind?: LastInfoGuideKind | null;
}): string {
  const prefix = formatIdleMetaCustomerPrefix(params.customerFirstName);
  const step = formatContinuityStep(
    params.threadText,
    params.pendingAction,
    null,
    params.lastGuideKind,
  );
  return `${prefix}${IDLE_PUSHBACK_APOLOGY} ${step}`;
}

export function buildMetaConversationalContinuityReply(
  threadText: string,
  opts?: {
    customerFirstName?: string | null;
    pendingAction?: PendingActionRecord | null;
    selectionText?: string | null;
    lastGuideKind?: LastInfoGuideKind | null;
  },
): string {
  const prefix = formatIdleMetaCustomerPrefix(opts?.customerFirstName);
  const step = formatContinuityStep(
    threadText,
    opts?.pendingAction,
    opts?.selectionText,
    opts?.lastGuideKind,
  );

  if (threadLastBotOutboundWasIdleClose(threadText)) {
    return `${prefix}${step}`;
  }
  // Pregunta de fork guía vs pending: no anteponer "Perfecto, seguimos".
  if (/^¿Seguimos con/i.test(step)) {
    return `${prefix}${step}`;
  }
  if (threadLastBotOutboundWasIdleNudge(threadText)) {
    return `${prefix}${/^Seguimos/i.test(step) ? `Perfecto, ${step}` : `Perfecto, seguimos. ${step}`}`;
  }
  if (
    step &&
    !/^Seguimos con lo que/.test(step) &&
    !/^¿En qué seguimos/i.test(step)
  ) {
    return `${prefix}${/^Seguimos/i.test(step) ? `Dale, ${step}` : `Dale, seguimos. ${step}`}`;
  }
  return `${prefix}Dale, seguimos. ¿En qué te ayudo?`;
}

export type IdleFollowupMetaTurnResult = {
  intercept: true;
  idlePushback: boolean;
  message: string;
  /** Si true, el caller no debe reemplazar el mensaje por resume de pendingAction. */
  preferGuideOverPending: boolean;
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
  lastGuideKind?: LastInfoGuideKind | null;
}): IdleFollowupMetaTurnResult | null {
  const { selectionText, threadText, customerFirstName, pendingAction, lastGuideKind } =
    params;

  const preferGuideOverPending = idleMetaShouldPreferGuideOverPending(
    threadText,
    pendingAction,
    lastGuideKind,
  );

  if (shouldHandleIdleFollowupPushback(selectionText, threadText)) {
    return {
      intercept: true,
      idlePushback: true,
      preferGuideOverPending,
      message: buildIdleFollowupPushbackReply({
        threadText,
        customerFirstName,
        pendingAction,
        lastGuideKind,
      }),
    };
  }

  if (looksLikeIdleNudgeAffirmation(selectionText, threadText)) {
    // Siempre retomar tema/pregunta previa; no tirar menú vacío «¿en qué te ayudo?».
    return {
      intercept: true,
      idlePushback: false,
      preferGuideOverPending,
      message: buildMetaConversationalContinuityReply(threadText, {
        customerFirstName,
        pendingAction,
        selectionText,
        lastGuideKind,
      }),
    };
  }

  if (looksLikeMetaConversationalReply(selectionText)) {
    return {
      intercept: true,
      idlePushback: false,
      preferGuideOverPending,
      message: buildMetaConversationalContinuityReply(threadText, {
        customerFirstName,
        pendingAction,
        selectionText,
        lastGuideKind,
      }),
    };
  }

  return null;
}
