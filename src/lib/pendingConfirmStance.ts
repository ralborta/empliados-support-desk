/**
 * Con un CONFIRMO pendiente, la IA razona qué quiere el cliente con un
 * "No" / rechazo / mensaje ambiguo — no asumir siempre "patente incorrecta".
 *
 * Bug 2026-08-10: "No" tras resumen de mantenimiento (que en realidad era una
 * consulta de estado) caía a "Entendido, no era esa… ¿cuál es la patente?".
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
} from "@/lib/waraApi";

const TIMEOUT_MS = Math.min(OPENAI_DEFAULT_TIMEOUT_MS, 7_000);

export type PendingConfirmKind = "mantenimiento" | "odometro" | "certificados";

export type PendingConfirmStanceAction =
  | "cancel_and_resume_query"
  | "cancel_tramite"
  | "correct_unit"
  | "unclear";

export type PendingConfirmStance = {
  action: PendingConfirmStanceAction;
  /** Consulta a reejecutar (estado/GPS) si action = cancel_and_resume_query */
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
- cancel_and_resume_query — El resumen de CONFIRMO NO correspondía: el cliente quería una CONSULTA (estado/GPS/reporte de unidad), no registrar un trámite. Cancelá el registro y devolvé en "query" el texto de esa consulta (el detalle del resumen o el mensaje si alcanza).
- cancel_tramite — El cliente rechaza / no quiere ese registro. Cancelá y listo (query=null).
- correct_unit — El cliente dice que la UNIDAD/patente del resumen está mal y quiere corregirla (no cancela el trámite entero).
- unclear — No se entiende; pedí aclaración breve en "clarify".

REGLAS DURAS:
- NUNCA elijas confirmar/registrar el trámite.
- Si el detalle era claramente "estado/reporte/GPS/ubicación de X" y el cliente dice No/nop/cancelá → preferí cancel_and_resume_query.
- "No" solo, sin más contexto de otra patente → casi nunca correct_unit; preferí cancel_tramite o cancel_and_resume_query.
- Español rioplatense en clarify. Sin emojis.

JSON:
{"action":"cancel_and_resume_query"|"cancel_tramite"|"correct_unit"|"unclear","query":string|null,"clarify":string|null,"confidence":0.0-1.0,"reason":"breve"}`;

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
    if (parsed.action === "cancel_and_resume_query" && !parsed.query) {
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
