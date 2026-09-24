/**
 * Cuando una consulta de unidad/GPS falla o el cliente insiste (“Y?”) sin respuesta útil,
 * disculpa en lenguaje natural + derivación a operador — nunca silencio.
 */
import type { PrismaClient } from "@prisma/client";
import {
  ensureRegisteredAdvisorHandoff,
  REGISTERED_ADVISOR_HANDOFF_WAITING_REPLY,
} from "@/lib/advisorHandoff";
import {
  looksLikeGpsOrUnitStatusQuestion,
  looksLikeLiveUnitConsultIntent,
  looksLikeVehicleBrandOrUnitSearch,
  threadHasRecentGpsStatusSummary,
  threadHasRecentLiveUnitConsultIntent,
} from "@/lib/waraApi";
import { extractBrandSearchLabel } from "@/lib/waraUnitIntent";

/** Variantes naturales (rioplatense) — se elige una por semilla, no un texto único quemado. */
const CONSULT_FAILURE_HANDOFF_VARIANTS = [
  "Disculpá, estamos con un problema puntual en las consultas de unidades. Mientras lo resolvemos te derivo con un operador para que te atiendan. Gracias por la paciencia.",
  "Perdón, ahora mismo las consultas de reporte/GPS nos están fallando. Para no dejarte esperando te paso con un asesor. Gracias.",
  "Disculpá la demora: estamos solucionando un tema con las consultas. Mientras tanto te transfiero con un operador. Gracias por entender.",
  "Uy, disculpá — tenemos un inconveniente técnico con las consultas en este momento. Te derivo con un asesor para que te ayuden ya. Gracias.",
  "Perdón, no te pude completar la consulta por un problema interno. Te paso con un operador mientras lo arreglamos. Gracias por la paciencia.",
];

function norm(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function hashSeed(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h;
}

/** Elige variante estable por teléfono/día (varía sin ser aleatorio por turno). */
export function pickConsultFailureHandoffReply(seed = ""): string {
  const day = new Date().toISOString().slice(0, 10);
  const idx = hashSeed(`${seed}|${day}`) % CONSULT_FAILURE_HANDOFF_VARIANTS.length;
  return CONSULT_FAILURE_HANDOFF_VARIANTS[idx]!;
}

/** “Y?”, “??”, “hola?”, “seguís?” — cliente esperando respuesta de una consulta. */
export function looksLikeImpatientConsultFollowUp(text: string | undefined | null): boolean {
  const raw = String(text ?? "").trim();
  if (!raw || raw.length > 40) return false;
  const t = norm(raw);
  if (
    /^(y\??|y+\?+|hola\??|buenas\??|\?{1,5}|eh\??|seguis\??|estas ahi\??|alguien\??|dale\??|bueno\??|ok\??|listo\??)$/.test(
      t,
    )
  ) {
    return true;
  }
  return /^(y entonces|y ahora|me respond[eé]s|me contestas|y la consulta|y el reporte)\??$/.test(t);
}

function botReplyLooksSatisfyingForUnitConsult(line: string): boolean {
  const t = norm(line);
  if (!t) return false;
  return (
    /estado gps|unidad detenida|falta de reporte|unidad no encontrada|no encontr[eé] ninguna unidad|deriv[eé] tu consulta|asesor de atencion|te paso con un|te derivo|te transfiero|operador|estamos con un problema|disculp/.test(
      t,
    ) || /📍|⏸|⚠️|🚗 \*unidad/.test(line)
  );
}

/**
 * Hubo pedido reciente de reporte/GPS/marca y el bot no dejó una respuesta útil después.
 */
export function threadHasRecentUnansweredUnitConsult(threadText: string): boolean {
  const lines = String(threadText ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return false;

  let lastAskIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!;
    const body = line.replace(/^(cliente|user|atilio|bot|assistant)\s*:\s*/i, "").trim();
    if (/^(atilio|bot|assistant)\s*:/i.test(line)) continue;
    if (
      looksLikeLiveUnitConsultIntent(body) ||
      looksLikeGpsOrUnitStatusQuestion(body) ||
      (looksLikeVehicleBrandOrUnitSearch(body) &&
        (looksLikeLiveUnitConsultIntent(body) ||
          looksLikeGpsOrUnitStatusQuestion(body) ||
          !!extractBrandSearchLabel(body)))
    ) {
      lastAskIdx = i;
      break;
    }
  }
  if (lastAskIdx < 0) {
    return threadHasRecentLiveUnitConsultIntent(threadText) && !threadHasRecentGpsStatusSummary(threadText);
  }

  for (let j = lastAskIdx + 1; j < lines.length; j++) {
    const line = lines[j]!;
    if (/^(cliente|user)\s*:/i.test(line)) continue;
    const body = line.replace(/^(atilio|bot|assistant)\s*:\s*/i, "").trim();
    if (botReplyLooksSatisfyingForUnitConsult(body) || botReplyLooksSatisfyingForUnitConsult(line)) {
      return false;
    }
  }
  return true;
}

export function shouldHandoffImpatientUnitConsultFollowUp(
  selectionText: string,
  threadText: string,
): boolean {
  if (!looksLikeImpatientConsultFollowUp(selectionText)) return false;
  // Si ya hubo un resumen GPS reciente, “Y?” puede ser otra cosa — no secuestrar.
  if (threadHasRecentGpsStatusSummary(threadText)) return false;
  // Pedido reciente de reporte/GPS (aunque el bot haya “respondido” en DB y BBC no lo
  // haya entregado — el cliente insiste → disculpa + operador).
  return (
    threadHasRecentLiveUnitConsultIntent(threadText) ||
    threadHasRecentUnansweredUnitConsult(threadText)
  );
}

/**
 * Abre/asegura ticket de asesor y devuelve mensaje de disculpa natural.
 * Si ya había handoff reciente, usa el “ya tenemos tu consulta”.
 */
export async function resolveConsultFailureAdvisorHandoff(
  prisma: PrismaClient,
  rawPhone: string,
  opts?: { messageText?: string; seed?: string; source?: string },
): Promise<{ message: string; ticketCode?: string }> {
  const handoff = await ensureRegisteredAdvisorHandoff(prisma, rawPhone, {
    messageText: opts?.messageText,
    source: opts?.source ?? "consult_failure_handoff",
    title: "Consulta de unidad/GPS — fallo técnico / sin respuesta",
  });
  if (!handoff.shouldNotifyCustomer) {
    return {
      message: REGISTERED_ADVISOR_HANDOFF_WAITING_REPLY,
      ticketCode: handoff.ticket.code,
    };
  }
  return {
    message: pickConsultFailureHandoffReply(opts?.seed ?? rawPhone),
    ticketCode: handoff.ticket.code,
  };
}
