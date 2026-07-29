/**
 * Capa de "humanización" de respuestas del bot — reglas siguen siendo la única fuente de
 * verdad para los DATOS (patente, km, horas, fecha, etc.); esto solo reformula el TEXTO
 * final para que suene a un agente humano y no a un formulario, sin tocar ningún dato.
 *
 * Mismo patrón ya probado en waraGpsSummary.ts (buildGpsClientSummary), generalizado para
 * reusarlo en otros flujos (odómetro/horómetro, tickets, certificados). Apagado por
 * defecto — activar explícitamente con WARA_HUMANIZE_REPLIES=true — para no arriesgar
 * nada en producción sin probarlo primero, y para que la suite de regresión (que compara
 * texto exacto en muchos casos) siga siendo 100% determinística por defecto.
 */
import OpenAI from "openai";
import { OPENAI_DEFAULT_TIMEOUT_MS, withOpenAiTimeout } from "@/lib/openaiTimeout";

export function isReplyHumanizerEnabled(): boolean {
  const raw = process.env.WARA_HUMANIZE_REPLIES?.trim().toLowerCase();
  if (raw === "true" || raw === "1" || raw === "yes") return true;
  return false;
}

const SYSTEM_PROMPT = `Sos Atilio, agente de Mesa de Ayuda Wara por WhatsApp. Te paso un mensaje
YA REDACTADO por el sistema (con todos los datos correctos: patente, km, horas, fecha, etc.).
Tu único trabajo es reformularlo para que suene a una persona real escribiendo por WhatsApp,
no a un formulario o un bot de reglas. Español rioplatense, cercano pero profesional, 1-4
oraciones, sin emojis, sin agregar información que no esté en el mensaje original.

Reglas ABSOLUTAS (no negociables):
- NUNCA cambies, redondees, inventes ni omitas ningún número, patente, fecha u hora que
  aparezca en el mensaje original. Deben aparecer EXACTAMENTE igual (mismos caracteres) en tu
  respuesta.
- NUNCA agregues un número de caso/ticket que no esté en el original.
- Si el mensaje original tiene una pregunta o pide una acción concreta (ej. "respondé
  CONFIRMO"), tu versión TAMBIÉN debe dejarla clara.
- Si no podés reformular sin arriesgar alguno de los puntos anteriores, devolvé el mensaje
  original sin cambios.

Devolvé SOLO el texto final del mensaje, sin comillas ni explicaciones.`;

/** Todas las secuencias de dígitos del texto (patentes, km, horas, fechas), para el chequeo de integridad. */
function extractDigitSequences(text: string): string[] {
  return text.match(/\d+/g) ?? [];
}

/** ¿La versión humanizada preserva exactamente las mismas secuencias numéricas que el original? */
function preservesAllNumbers(original: string, candidate: string): boolean {
  const originalNums = extractDigitSequences(original);
  if (originalNums.length === 0) return true;
  const candidateNums = extractDigitSequences(candidate);
  return originalNums.every((n) => candidateNums.includes(n));
}

/**
 * Reformula `template` (ya con los datos correctos calculados por reglas) para que suene
 * más natural. Si la IA está deshabilitada, no hay API key, falla, tarda demasiado, o el
 * resultado no preserva todos los números del original, devuelve `template` sin cambios —
 * nunca hay riesgo de perder o alterar un dato real.
 */
export async function humanizeBotReply(
  template: string,
  opts?: { context?: string },
): Promise<string> {
  const clean = template?.trim();
  if (!clean) return template;
  if (!isReplyHumanizerEnabled()) return template;
  if (!process.env.OPENAI_API_KEY?.trim()) return template;

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const userContent = opts?.context
      ? `contexto: ${opts.context}\n\nmensaje_original:\n${clean}`
      : `mensaje_original:\n${clean}`;
    const response = await withOpenAiTimeout(
      (signal) =>
        openai.chat.completions.create(
          {
            model: "gpt-4o-mini",
            messages: [
              { role: "system", content: SYSTEM_PROMPT },
              { role: "user", content: userContent },
            ],
            temperature: 0.3,
            max_tokens: 220,
          },
          { signal },
        ),
      OPENAI_DEFAULT_TIMEOUT_MS,
    );
    const candidate = response?.choices?.[0]?.message?.content?.trim();
    if (!candidate || candidate.length < 8) return template;
    if (!preservesAllNumbers(clean, candidate)) return template;
    return candidate;
  } catch (error) {
    console.warn("[botReplyHumanizer] IA falló, uso plantilla:", error instanceof Error ? error.message : error);
    return template;
  }
}
