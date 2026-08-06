/**
 * Nivel 2 de interacción con IA para el trámite de odómetro/horómetro — a diferencia de
 * botReplyHumanizer.ts (que solo REDACTA mejor un mensaje ya decidido), acá la IA participa
 * en decidir QUÉ preguntar o responder, usando el historial completo de la conversación.
 *
 * El backend (route.ts) sigue siendo la ÚNICA fuente de verdad sobre los DATOS: qué patente,
 * qué km/horas, qué fecha, qué falta, si ya se puede confirmar. Este módulo nunca decide esos
 * valores — solo la forma en la que se comunican. Antes de usar la respuesta de la IA se
 * valida que contenga EXACTAMENTE los datos obligatorios (requiredTokens) y, si corresponde,
 * la palabra CONFIRMO — si algo no matchea, se descarta y se usa `fallbackTemplate` (el mismo
 * mensaje fijo que el sistema manda hoy), así el peor caso es idéntico al comportamiento actual.
 *
 * Apagado por defecto — activar con WARA_DIALOGUE_AI_ODOMETRO=true.
 */
import OpenAI from "openai";
import { OPENAI_DEFAULT_TIMEOUT_MS, withOpenAiTimeout } from "@/lib/openaiTimeout";
import { formatCalendarContextBlock } from "@/lib/odometroFecha";

export function isOdometerDialogueAiEnabled(): boolean {
  const raw = process.env.WARA_DIALOGUE_AI_ODOMETRO?.trim().toLowerCase();
  if (raw === "true" || raw === "1" || raw === "yes") return true;
  return false;
}

export type OdometerDialogueSituation =
  | "missing_plate"
  | "missing_value"
  | "missing_fecha_hora"
  | "confirmation_summary"
  | "correction_prompt"
  | "success"
  | "error_not_found";

const SITUATION_GUIDANCE: Record<OdometerDialogueSituation, string> = {
  missing_plate:
    "Necesitás que el cliente te diga qué unidad es (patente, nombre interno o marca). Pedíselo de forma clara, tomando en cuenta lo que ya dijo (no repitas literalmente su mensaje, pero mostrale que lo leíste).",
  missing_value:
    "Ya sabés qué unidad es. Pedí JUNTOS el valor nuevo (odómetro en km u horómetro en horas) Y la fecha y hora de la lectura, con un ejemplo concreto. Si la lectura fue recién, que manden el valor y la palabra ahora. No digas CONFIRMO todavía.",
  missing_fecha_hora:
    "Ya tenés unidad y valor (km u horas). FALTA la fecha y hora de la lectura — son obligatorias. Pedilas con un ejemplo concreto (ej. 05/08/26 a las 14:30). Si la lectura fue recién, que responda la palabra ahora. NO digas CONFIRMO todavía ni asumas «hoy» en silencio.",
  confirmation_summary:
    "Ya tenés todos los datos (patente, valor, y fecha si corresponde). Presentaselos con claridad al cliente para que los revise, y pedile EXPLÍCITAMENTE que responda la palabra CONFIRMO para registrar el cambio. Es un paso de validación, no lo hagas ambiguo.",
  correction_prompt:
    "El cliente está pidiendo corregir algo del trámite pero no especificó qué dato ni el valor nuevo. Preguntale con calidez qué dato quiere corregir (patente, odómetro o horómetro) y el valor correcto, dejando claro que después de eso le vas a volver a pedir CONFIRMO.",
  success:
    "El cambio se registró con éxito en Wara. Confirmaselo al cliente de forma clara y cálida, con los datos que se registraron.",
  error_not_found:
    "Hubo un problema (la unidad no se encontró, o Wara rechazó el registro). Explicaselo al cliente con claridad y dale una alternativa concreta (ej. probar otra patente, escribir 'listado de mis unidades', o hablar con un asesor) — no lo dejes sin salida.",
};

const SYSTEM_PROMPT = `Sos Atilio, agente de Mesa de Ayuda Wara, atendiendo por WhatsApp el trámite
de cambio de odómetro/horómetro de una unidad de flota. Español rioplatense, cercano y
profesional, 1-4 oraciones, sin emojis, sin firmar ("Atilio", "Saludos", etc.).

Te paso: el historial reciente de la conversación, los DATOS YA CONFIRMADOS del trámite (si
hay), y la situación actual. Tu trabajo es redactar la respuesta que corresponde a esa
situación, leyendo el historial para que la respuesta tenga sentido con lo que el cliente
viene diciendo (no repitas preguntas que ya respondió, no ignores lo que acaba de decir).

Reglas ABSOLUTAS (no negociables, tu respuesta se descarta si las rompés):
- Si te paso "datos_confirmados", esos valores (patente, km, horas, fecha) DEBEN aparecer en
  tu respuesta EXACTAMENTE con los mismos caracteres que te los pasé. No los redondees, no los
  reformatees, no inventes ninguno adicional.
- Si la situación es "confirmation_summary" o dice que hace falta CONFIRMO, tu respuesta DEBE
  contener literalmente la palabra "CONFIRMO" en mayúsculas.
- Nunca inventes un número de caso/ticket.
- Nunca prometas algo que no esté en los datos que te pasaron.
- Para "hoy/ayer/anteayer" usá SOLO el bloque fecha_referencia — nunca otra fecha.

Devolvé SOLO el texto final del mensaje de WhatsApp, sin comillas ni explicaciones.`;

export type OdometerDialogueRequest = {
  situation: OdometerDialogueSituation;
  history: string;
  lastCustomerMessage: string;
  /** Valores ya confirmados que DEBEN aparecer tal cual en la respuesta (ej. "AB 006 EX", "125852 km"). */
  requiredTokens?: string[];
  requireConfirmoWord?: boolean;
  /** Si el trámite ya sabe si es odómetro (km) u horómetro (hs), para no preguntar por ambos. */
  fieldHint?: "odometro" | "horometro";
  fallbackTemplate: string;
};

function responseContainsAllTokens(text: string, tokens: string[] | undefined): boolean {
  if (!tokens || tokens.length === 0) return true;
  return tokens.every((token) => text.includes(token));
}

/**
 * Compone la respuesta del trámite de odómetro/horómetro para la situación dada, dejando que
 * la IA decida la redacción (no solo la forma) del mensaje. Si la IA está deshabilitada, no
 * hay API key, falla, tarda demasiado, o el resultado no pasa la validación de integridad
 * (todos los requiredTokens presentes + CONFIRMO si corresponde + longitud razonable),
 * devuelve `fallbackTemplate` sin cambios — mismo comportamiento que el sistema tiene hoy.
 */
export async function composeOdometerDialogueReply(req: OdometerDialogueRequest): Promise<string> {
  if (!isOdometerDialogueAiEnabled()) return req.fallbackTemplate;
  if (!process.env.OPENAI_API_KEY?.trim()) return req.fallbackTemplate;

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const userContent = [
      "fecha_referencia:",
      formatCalendarContextBlock("America/Argentina/Buenos_Aires"),
      "",
      `situacion: ${req.situation}`,
      `guia_situacion: ${SITUATION_GUIDANCE[req.situation]}`,
      req.fieldHint
        ? `campo_del_tramite: ${req.fieldHint} (NO preguntes por el otro campo, ya se sabe cuál es)`
        : "campo_del_tramite: (todavía no se sabe si es odómetro u horómetro)",
      req.requiredTokens?.length ? `datos_confirmados (deben aparecer tal cual): ${req.requiredTokens.join(" | ")}` : "datos_confirmados: (ninguno todavía)",
      req.requireConfirmoWord ? "requiere_palabra_confirmo: true" : "requiere_palabra_confirmo: false",
      "",
      "historial reciente (más abajo = más nuevo):",
      req.history.slice(-3000) || "(vacío)",
      "",
      "ultimo_mensaje_del_cliente:",
      req.lastCustomerMessage,
    ].join("\n");

    const response = await withOpenAiTimeout(
      (signal) =>
        openai.chat.completions.create(
          {
            model: "gpt-4o-mini",
            messages: [
              { role: "system", content: SYSTEM_PROMPT },
              { role: "user", content: userContent },
            ],
            temperature: 0.4,
            max_tokens: 220,
          },
          { signal },
        ),
      OPENAI_DEFAULT_TIMEOUT_MS,
    );
    const candidate = response?.choices?.[0]?.message?.content?.trim();
    if (!candidate || candidate.length < 8) return req.fallbackTemplate;
    if (!responseContainsAllTokens(candidate, req.requiredTokens)) return req.fallbackTemplate;
    if (req.requireConfirmoWord && !/\bCONFIRMO\b/.test(candidate)) return req.fallbackTemplate;
    return candidate;
  } catch (error) {
    console.warn(
      "[odometerDialogueAI] IA falló, uso plantilla:",
      error instanceof Error ? error.message : error,
    );
    return req.fallbackTemplate;
  }
}
