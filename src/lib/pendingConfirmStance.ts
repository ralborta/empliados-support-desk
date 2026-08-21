/**
 * Con un CONFIRMO pendiente, la IA razona qué quiere el cliente con un
 * "No" / rechazo / mensaje ambiguo — no asumir siempre "patente incorrecta".
 *
 * Bug 2026-08-10: "No" tras resumen de mantenimiento (que en realidad era una
 * consulta de estado) caía a "Entendido, no era esa… ¿cuál es la patente?".
 *
 * Bug 2026-08-10 (odo): "quiero otra consulta" con CONFIRMO pendiente suele ser
 * pedir un dato del mismo tema ANTES de continuar — no borrar el registro.
 */
import OpenAI from "openai";
import { OPENAI_DEFAULT_TIMEOUT_MS, withOpenAiTimeout } from "@/lib/openaiTimeout";
import {
  extractPendingMaintenanceDetalle,
  hasPendingCertificateConfirmation,
  hasPendingMantenimientoConfirmation,
  hasPendingOdometerConfirmation,
  looksLikeBareNegativeResponse,
  looksLikeUnitRejection,
} from "@/lib/wara";
import {
  looksLikeGpsOrUnitStatusQuestion,
  looksLikeLiveUnitConsultIntent,
  looksLikeMaintenanceConfirmationRejection,
  looksLikeOdometerConfirmationRejection,
  looksLikePendingConfirmDeferForOtherQuery,
} from "@/lib/waraApi";

const TIMEOUT_MS = Math.min(OPENAI_DEFAULT_TIMEOUT_MS, 7_000);

export type PendingConfirmKind = "mantenimiento" | "odometro" | "certificados";

export type PendingConfirmStanceAction =
  | "cancel_and_resume_query"
  | "cancel_tramite"
  | "pause_for_side_query"
  | "correct_unit"
  | "unclear";

export type PendingConfirmStance = {
  action: PendingConfirmStanceAction;
  /** Consulta a ejecutar (estado/GPS) si action = cancel_and_resume_query | pause_for_side_query */
  query: string | null;
  confidence: number;
  clarify: string | null;
  reason?: string;
  fuente: "ia" | "heuristica";
};

function iaEnabled(): boolean {
  if (process.env.WARA_PENDING_CONFIRM_IA_ENABLED === "false") return false;
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

export function detectPendingConfirmKind(threadText: string): PendingConfirmKind | null {
  if (hasPendingCertificateConfirmation(threadText)) return "certificados";
  if (hasPendingOdometerConfirmation(threadText)) return "odometro";
  if (hasPendingMantenimientoConfirmation(threadText)) return "mantenimiento";
  return null;
}

/** ¿El mensaje parece rechazo / negación / corrección ante un CONFIRMO pendiente? */
export function looksLikePendingConfirmPushback(text: string, kind: PendingConfirmKind): boolean {
  // Abrir puerta a la IA: otra consulta / dato antes de confirmar, etc.
  if (looksLikePendingConfirmDeferForOtherQuery(text)) return true;
  if (kind === "mantenimiento" && looksLikeMaintenanceConfirmationRejection(text)) return true;
  if (kind === "odometro" && looksLikeOdometerConfirmationRejection(text)) return true;
  if (kind === "certificados" && looksLikeMaintenanceConfirmationRejection(text)) return true;
  if (looksLikeBareNegativeResponse(text) || looksLikeUnitRejection(text)) return true;
  return false;
}

function heuristicStance(
  selectionText: string,
  threadText: string,
  kind: PendingConfirmKind,
): PendingConfirmStance {
  if (kind === "mantenimiento") {
    const detalle = extractPendingMaintenanceDetalle(threadText);
    if (
      detalle &&
      (looksLikeGpsOrUnitStatusQuestion(detalle) || looksLikeLiveUnitConsultIntent(detalle))
    ) {
      return {
        action: "cancel_and_resume_query",
        query: detalle,
        confidence: 0.7,
        clarify: null,
        reason: "detalle del resumen era consulta de estado",
        fuente: "heuristica",
      };
    }
  }
  // Otra consulta / dato adicional del mismo tema → pausar CONFIRMO (no borrarlo).
  if (looksLikePendingConfirmDeferForOtherQuery(selectionText)) {
    const maybeQuery =
      looksLikeGpsOrUnitStatusQuestion(selectionText) || looksLikeLiveUnitConsultIntent(selectionText)
        ? selectionText.trim()
        : null;
    return {
      action: "pause_for_side_query",
      query: maybeQuery,
      confidence: 0.85,
      clarify: null,
      reason: "consulta lateral antes de CONFIRMO",
      fuente: "heuristica",
    };
  }
  // "No" / "no es esa" corto → cancelar trámite (no insistir con patente).
  if (looksLikeBareNegativeResponse(selectionText) || /^(no|nop|nope)\b/i.test(selectionText.trim())) {
    return {
      action: "cancel_tramite",
      query: null,
      confidence: 0.65,
      clarify: null,
      reason: "negación breve ante CONFIRMO",
      fuente: "heuristica",
    };
  }
  if (looksLikeUnitRejection(selectionText) && !looksLikeBareNegativeResponse(selectionText)) {
    return {
      action: "correct_unit",
      query: null,
      confidence: 0.6,
      clarify:
        "Entendido. ¿Cuál es la patente o unidad correcta? Pasame la matrícula o la marca/nombre.",
      reason: "parece corrección de unidad",
      fuente: "heuristica",
    };
  }
  return {
    action: "cancel_tramite",
    query: null,
    confidence: 0.55,
    clarify: null,
    reason: "fallback cancelar trámite",
    fuente: "heuristica",
  };
}

function parseStance(raw: string): Omit<PendingConfirmStance, "fuente"> | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const action = String(parsed.action ?? "").trim() as PendingConfirmStanceAction;
    const allowed: PendingConfirmStanceAction[] = [
      "cancel_and_resume_query",
      "cancel_tramite",
      "pause_for_side_query",
      "correct_unit",
      "unclear",
    ];
    if (!allowed.includes(action)) return null;
    const confidence = Number(parsed.confidence);
    if (!Number.isFinite(confidence)) return null;
    const query =
      typeof parsed.query === "string" && parsed.query.trim()
        ? parsed.query.trim().slice(0, 220)
        : null;
    const clarify =
      typeof parsed.clarify === "string" && parsed.clarify.trim()
        ? parsed.clarify.trim().slice(0, 280)
        : null;
    return {
      action,
      query,
      confidence: Math.max(0, Math.min(1, confidence)),
      clarify,
      reason: typeof parsed.reason === "string" ? parsed.reason.slice(0, 160) : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Razona qué hacer con el mensaje del cliente mientras hay un resumen CONFIRMO pendiente.
 * Nunca sugiere registrar / confirmar el trámite.
 */
export async function reasonPendingConfirmationRejection(params: {
  selectionText: string;
  threadText: string;
  kind: PendingConfirmKind;
}): Promise<PendingConfirmStance> {
  const { selectionText, threadText, kind } = params;
  const fallback = heuristicStance(selectionText, threadText, kind);

  if (!iaEnabled()) return fallback;

  const detalle =
    kind === "mantenimiento" ? extractPendingMaintenanceDetalle(threadText) : null;

  const system = `Sos Atilio, agente de Wara. Hay un resumen pendiente de CONFIRMO (el bot pidió confirmar un trámite).
El cliente acaba de responder. Tu trabajo es RAZONAR la intención — no inventes datos.

Trámite pendiente: ${kind}
Detalle del resumen (si hay): ${detalle || "(sin detalle)"}

Acciones posibles (elegí UNA):
- pause_for_side_query — El cliente quiere un DATO o CONSULTA (a menudo del mismo tema/unidad) ANTES de continuar con el CONFIRMO. NO borres el registro pendiente. Si el mensaje ya trae la consulta concreta, ponela en "query"; si no, query=null.
- cancel_and_resume_query — El resumen de CONFIRMO NO correspondía (era una consulta disfrazada de trámite) o el cliente ABANDONA el registro y pide una consulta en su lugar. Ahí SÍ se cancela el pendiente. Poné la consulta en "query".
- cancel_tramite — Rechazo claro: no quiere registrar (cancelá/olvidalo/no confirmo/desestima SIN pedir otra consulta). query=null.
- correct_unit — La UNIDAD/patente del resumen está mal; quiere corregirla (no cancela el trámite entero).
- unclear — No se entiende; pedí aclaración breve en "clarify".

REGLAS DURAS:
- NUNCA elijas confirmar/registrar el trámite.
- "quiero hacer otra consulta", "antes de confirmar", "necesito un dato" → pause_for_side_query (NO cancel_tramite).
- "desestima/cancelá" + "otra consulta" en el mismo mensaje → pause_for_side_query (quiere pausar para consultar, no abandonar del todo).
- Si el detalle era claramente "estado/reporte/GPS/ubicación de X" y el cliente dice No/nop/cancelá → preferí cancel_and_resume_query.
- "No" solo, sin más contexto de otra patente → casi nunca correct_unit; preferí cancel_tramite o cancel_and_resume_query.
- Español rioplatense en clarify. Sin emojis.

JSON:
{"action":"pause_for_side_query"|"cancel_and_resume_query"|"cancel_tramite"|"correct_unit"|"unclear","query":string|null,"clarify":string|null,"confidence":0.0-1.0,"reason":"breve"}`;

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await withOpenAiTimeout(
      (signal) =>
        openai.chat.completions.create(
          {
            model:
              process.env.WARA_PENDING_CONFIRM_MODEL?.trim() ||
              process.env.WARA_UTTERANCE_MODEL?.trim() ||
              "gpt-4o-mini",
            messages: [
              { role: "system", content: system },
              {
                role: "user",
                content: [
                  "historial (más abajo = más nuevo):",
                  threadText.slice(-3200) || "(vacío)",
                  "",
                  "mensaje_nuevo:",
                  selectionText.trim(),
                ].join("\n"),
              },
            ],
            temperature: 0.1,
            max_tokens: 220,
            response_format: { type: "json_object" },
          },
          { signal },
        ),
      TIMEOUT_MS,
    );
    const content = response?.choices?.[0]?.message?.content?.trim();
    if (!content) return fallback;
    const parsed = parseStance(content);
    if (!parsed || parsed.confidence < 0.55) return fallback;
    if (
      (parsed.action === "cancel_and_resume_query" || parsed.action === "pause_for_side_query") &&
      !parsed.query &&
      parsed.action === "cancel_and_resume_query"
    ) {
      parsed.query = detalle || selectionText.trim();
    }
    return { ...parsed, fuente: "ia" };
  } catch (err) {
    console.warn(
      "[pendingConfirmStance] IA falló; heurística:",
      err instanceof Error ? err.message : err,
    );
    return fallback;
  }
}

/** Recordatorio corto: el CONFIRMO sigue vivo tras una consulta lateral. */
export function buildPendingConfirmStillWaitingReminder(kind: PendingConfirmKind): string {
  if (kind === "odometro") {
    return "El cambio de odómetro/horómetro sigue pendiente: cuando quieras, respondé CONFIRMO para registrarlo, o decime qué corregir.";
  }
  if (kind === "certificados") {
    return "El certificado sigue pendiente: cuando quieras, respondé CONFIRMO, o decime qué corregir.";
  }
  return "El mantenimiento del resumen sigue pendiente: cuando quieras, respondé CONFIRMO, o decime qué corregir.";
}

/** Explica el paso CONFIRMO/CANCELAR sin pisar el detalle del resumen. */
export function buildPendingConfirmHelpReply(kind: PendingConfirmKind): string {
  const common = [
    "Para *registrarlo* respondé *CONFIRMO*.",
    "Si no querés cargarlo, respondé *CANCELAR*.",
    "Si algún dato está mal, decime qué corregir.",
  ];
  if (kind === "mantenimiento") {
    return [
      "Tranqui: ya armé el resumen de la tarea de mantenimiento.",
      ...common,
    ].join("\n");
  }
  if (kind === "odometro") {
    return [
      "Tranqui: ya armé el resumen del odómetro/horómetro.",
      ...common,
    ].join("\n");
  }
  return [
    "Tranqui: ya armé el resumen del certificado.",
    ...common,
  ].join("\n");
}
