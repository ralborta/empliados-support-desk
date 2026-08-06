/**
 * Capa de comprensión en lenguaje natural del mensaje del usuario.
 *
 * Principio: TODO mensaje de cliente pasa por la IA (interpretar intención + hilo).
 * Las reglas operativas NO hablan solas: solo EJECUTAN cuando la intención ya está clara
 * (CONFIRMO de trámite, km, odómetro estructurado, etc.).
 *
 * Si la IA duda → pregunta. Si falla OpenAI → fallback a reglas (no bloquea el turno).
 *
 * Activar/desactivar: WARA_UTTERANCE_UNDERSTANDING (default: encendido).
 */
import OpenAI from "openai";
import { OPENAI_DEFAULT_TIMEOUT_MS, withOpenAiTimeout } from "@/lib/openaiTimeout";

const UNDERSTAND_TIMEOUT_MS = Math.min(OPENAI_DEFAULT_TIMEOUT_MS, 8_000);
const MIN_CONFIDENCE = 0.72;
/** Mensajes más largos igual se interpretan; el hilo ya trae contexto. */
const MAX_INTERPRET_CHARS = 220;

export type UtteranceReferent =
  | "vehicle_unit"
  | "admin_number"
  | "menu_option"
  | "confirmation"
  | "odometer_data"
  | "new_request"
  | "other"
  | "unclear";

export type UtteranceUnderstanding = {
  referent: UtteranceReferent;
  confidence: number;
  clarifyQuestion: string | null;
  reason?: string;
};

export function isUtteranceUnderstandingEnabled(): boolean {
  const raw = process.env.WARA_UTTERANCE_UNDERSTANDING?.trim().toLowerCase();
  if (raw === "false" || raw === "0" || raw === "no") return false;
  return true;
}

const SYSTEM_PROMPT = `Sos el intérprete de intención de Atilio (Mesa de Ayuda Wara por WhatsApp).
Tu trabajo: entender a qué se refiere el mensaje_nuevo dado el historial (sobre todo la última pregunta del bot).
NO inventes patentes, km ni trámites. Si dudás, pedí aclaración.
Tolerá errores de escritura / typos / abreviaturas: interpretá la intención igual.
El cliente puede mandar datos EN DESORDEN o incompletos (km sin patente, pregunta de ticket en medio de otra cosa, etc.): mirá el hilo y clasificá la intención real del mensaje_nuevo, no el orden ideal del trámite.

Devolvé SOLO JSON válido:
{"referent":"vehicle_unit|admin_number|menu_option|confirmation|odometer_data|new_request|other|unclear","confidence":0.0-1.0,"clarify_question":string|null,"reason":"breve"}

Significado de referent:
- vehicle_unit — el cliente indica o busca una UNIDAD (patente, prefijo de matrícula, marca, nombre, "la que empieza con…").
- admin_number — habla de un NÚMERO administrativo: NRO/N°/número de caso, interno, ticket, teléfono, código — NO es prefijo de patente.
- menu_option — elige opción de menú (empresa 1/2, sí/no de lista).
- confirmation — confirma o rechaza un resumen (CONFIRMO, dale, ok, no, tks/gracias como cierre).
- odometer_data — aporta km/hs/fecha para un trámite de odómetro/horómetro ya en curso (aunque lo mande "antes de tiempo").
- new_request — pide un trámite o tema nuevo (odómetro, GPS, certificado, mantenimiento, ayuda…).
- other — otra cosa entendible (saludo, gracias, chitchat).
- unclear — no se entiende con seguridad a qué se refiere.

Reglas:
- Si el mensaje trae una matrícula/patente reconocible (ej. AF061DO, AD 427 MC) junto a un pedido de reporte/GPS/estado → vehicle_unit con alta confianza. NO lo trates como número de caso.
- "NRO", "N°", "nro 12", "numero 45" suelen ser admin_number, SALVO que el hilo pida explícitamente patente/prefijo Y el cliente diga "empieza con NRO" / "patente NRO…".
- Un token de 2-3 letras (OST, AG, NKL) SOLO es vehicle_unit si el contexto es buscar/elegir unidad o el cliente lo marca como matrícula/prefijo.
- Si habla de unidad/patente (aunque esté mal escrito) pero NO trae la matrícula concreta → pedí la chapa en clarify_question.
- Si confidence < 0.75 → preferí unclear y preguntá.
- clarify_question: español rioplatense, corto, conversacional, sin emojis. null si no hace falta aclarar.
- Ejemplos: "¿A qué te referís con NRO: un número de caso/interno, o parte de una patente?" / "No te seguí: ¿me estás pasando una matrícula o un número de otra cosa?"`;

const FALLBACK_CLARIFY =
  "No te seguí del todo. ¿Me estás pasando una patente o parte de ella, o un número de otra cosa (caso, interno, opción)?";

/**
 * Casi todo mensaje va a la IA. Solo se excluye vacío / demasiado largo.
 * Las exclusiones “esquemáticas” anteriores hacían respuestas de robot.
 */
export function shouldInterpretAmbiguousUtterance(
  selectionText: string,
  _threadText = "",
): boolean {
  const text = selectionText.trim();
  if (!text) return false;
  if (text.length > MAX_INTERPRET_CHARS) return false;
  return true;
}

function parseUnderstanding(raw: string): UtteranceUnderstanding | null {
  try {
    const parsed = JSON.parse(raw) as {
      referent?: string;
      confidence?: number;
      clarify_question?: string | null;
      reason?: string;
    };
    const referent = String(parsed.referent ?? "").trim() as UtteranceReferent;
    const valid: UtteranceReferent[] = [
      "vehicle_unit",
      "admin_number",
      "menu_option",
      "confirmation",
      "odometer_data",
      "new_request",
      "other",
      "unclear",
    ];
    if (!valid.includes(referent)) return null;
    const confidence = Number(parsed.confidence);
    if (!Number.isFinite(confidence)) return null;
    const clarify =
      typeof parsed.clarify_question === "string" && parsed.clarify_question.trim()
        ? parsed.clarify_question.trim().slice(0, 280)
        : null;
    return {
      referent,
      confidence: Math.max(0, Math.min(1, confidence)),
      clarifyQuestion: clarify,
      reason: typeof parsed.reason === "string" ? parsed.reason : undefined,
    };
  } catch {
    return null;
  }
}

export async function understandUserUtterance(
  selectionText: string,
  threadText: string,
): Promise<UtteranceUnderstanding | null> {
  if (!isUtteranceUnderstandingEnabled()) return null;
  if (!process.env.OPENAI_API_KEY?.trim()) return null;
  if (!shouldInterpretAmbiguousUtterance(selectionText, threadText)) return null;

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const user = [
      "historial (más abajo = más nuevo):",
      threadText.slice(-3500) || "(vacío)",
      "",
      "mensaje_nuevo:",
      selectionText.trim(),
    ].join("\n");

    const response = await withOpenAiTimeout(
      (signal) =>
        openai.chat.completions.create(
          {
            model: process.env.WARA_UTTERANCE_MODEL?.trim() || "gpt-4o-mini",
            messages: [
              { role: "system", content: SYSTEM_PROMPT },
              { role: "user", content: user },
            ],
            temperature: 0.1,
            max_tokens: 160,
            response_format: { type: "json_object" },
          },
          { signal },
        ),
      UNDERSTAND_TIMEOUT_MS,
    );

    const content = response?.choices?.[0]?.message?.content?.trim();
    if (!content) return null;
    return parseUnderstanding(content);
  } catch (err) {
    console.warn(
      "[utteranceUnderstanding] falló; se sigue con reglas:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/**
 * Si hace falta aclarar antes de ejecutar reglas. No aclara confirmaciones /
 * menú / trámites claros — eso lo ejecutan las reglas operativas.
 */
export function clarificationFromUnderstanding(
  understanding: UtteranceUnderstanding | null,
  rawText?: string,
): string | null {
  if (!understanding) return null;

  const lowConfidence = understanding.confidence < MIN_CONFIDENCE;
  if (shouldAnswerOpenCaseFromUnderstanding(understanding, rawText ?? "")) {
    return null;
  }

  // Intenciones operativas claras → no interrumpir con pregunta.
  if (
    !lowConfidence &&
    (understanding.referent === "confirmation" ||
      understanding.referent === "menu_option" ||
      understanding.referent === "odometer_data" ||
      understanding.referent === "new_request" ||
      understanding.referent === "other" ||
      understanding.referent === "vehicle_unit")
  ) {
    return null;
  }

  const needsClarify =
    understanding.referent === "unclear" ||
    understanding.referent === "admin_number" ||
    lowConfidence;

  if (!needsClarify) return null;

  if (understanding.referent === "admin_number") {
    return (
      understanding.clarifyQuestion?.trim() ||
      "¿A qué número te referís: caso/ticket, interno, o parte de una patente?"
    );
  }

  return understanding.clarifyQuestion?.trim() || FALLBACK_CLARIFY;
}

/**
 * La IA dijo número admin + mensaje/hilo de caso → responder caso abierto.
 */
export function shouldAnswerOpenCaseFromUnderstanding(
  understanding: UtteranceUnderstanding | null,
  rawText: string,
  threadText = "",
): boolean {
  if (!understanding) return false;
  if (understanding.confidence < MIN_CONFIDENCE) return false;
  if (understanding.referent !== "admin_number") return false;

  const text = rawText.trim();
  if (!text) return false;

  const mentionsCaseOrTicket =
    /\b(ticket|caso|reclamo|gesti[oó]n)\b/i.test(text);
  const threadHasCaseCue =
    /caso abierto|#\d+|gener[eé] un caso|registr[eé] la consulta en el caso/i.test(
      threadText.slice(-4000),
    );

  if (mentionsCaseOrTicket) return true;
  if (threadHasCaseCue && text.split(/\s+/).length >= 3) return true;
  return false;
}

/** ¿Seguir tratando el mensaje como búsqueda/selección de unidad según la IA? */
export function shouldProceedAsVehicleUnit(
  understanding: UtteranceUnderstanding | null,
): boolean {
  if (!understanding) return true; // sin IA → reglas como siempre
  if (understanding.confidence < MIN_CONFIDENCE) return false;
  return understanding.referent === "vehicle_unit";
}
