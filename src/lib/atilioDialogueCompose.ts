/**
 * Redacción conversacional a partir de dialogue_state — sin dependencia circular con tools.
 */
import OpenAI from "openai";
import type { ExecutorDialogueState } from "@/lib/executorDialogueState";
import { OPENAI_DEFAULT_TIMEOUT_MS, withOpenAiTimeout } from "@/lib/openaiTimeout";

export function isAtilioAgentEnabled(): boolean {
  const raw = process.env.WARA_AGENT_MODE?.trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}

function agentModel(): string {
  return process.env.WARA_AGENT_MODEL?.trim() || "gpt-4o-mini";
}

const DIALOGUE_COMPOSE_PROMPT = `Sos Atilio por WhatsApp. Te paso el historial, el mensaje del cliente y HECHOS VERIFICADOS del sistema.
Redactá UNA respuesta conversacional (no un formulario).

RAZONAMIENTO OBLIGATORIO (en silencio, no lo escribas):
1. ¿Qué preguntó o dijo el cliente EN ESTE mensaje? Respondé ESO primero.
2. ¿Qué ya se explicó en el hilo? NO repitas lo mismo ni re-ofrezcas acciones ya hechas.
3. ¿Qué falta? Una sola pregunta concreta, solo si hace falta.

REGLAS DE REDACCIÓN:
- Español rioplatense, cercano, 1-4 oraciones, sin emojis.
- Mencioná la unidad UNA vez con etiqueta corta (ej. "MYQ 693"); no repitas el bloque nombre+largo en cada frase.
- Usá SOLO los hechos del JSON — nunca inventes tiempos, estados ni números de caso.
- Si caso_abierto=true, NO ofrezcas abrir otro ticket — confirmá que ya quedó registrado.
- Si preguntan "hace cuánto" y no hay equipo/GPS, explicá con empatía que no hay telemetría para medir eso.
- Si el cliente confirma ("ah ok entonces...", "verdad?"), respondé directo sí/no — sin repetir el diagnóstico entero.
- NUNCA sugieras revisar cables si los hechos dicen que no hay equipo instalado.

Devolvé SOLO el texto para WhatsApp.`;

export type ComposeDialogueInput = {
  threadText: string;
  customerMessage: string;
  dialogueState: ExecutorDialogueState;
  fallbackTemplate?: string;
};

/** Redacta respuesta conversacional a partir de hechos estructurados del backend. */
export async function composeAgentReplyFromDialogueState(
  input: ComposeDialogueInput,
): Promise<string> {
  const fallback = input.fallbackTemplate?.trim();
  if (!isAtilioAgentEnabled() || !process.env.OPENAI_API_KEY?.trim()) {
    return fallback ?? input.dialogueState.hechos.join(" ");
  }

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const userContent = [
      "historial reciente:",
      input.threadText.slice(-2500) || "(vacío)",
      "",
      "mensaje_cliente:",
      input.customerMessage,
      "",
      "hechos_verificados:",
      JSON.stringify(input.dialogueState, null, 2),
      fallback ? `\nplantilla_respaldo (solo si no podés redactar mejor):\n${fallback}` : "",
    ].join("\n");

    const response = await withOpenAiTimeout(
      (signal) =>
        openai.chat.completions.create(
          {
            model: agentModel(),
            messages: [
              { role: "system", content: DIALOGUE_COMPOSE_PROMPT },
              { role: "user", content: userContent },
            ],
            temperature: 0.5,
            max_tokens: 280,
          },
          { signal },
        ),
      OPENAI_DEFAULT_TIMEOUT_MS,
    );
    const text = response?.choices?.[0]?.message?.content?.trim();
    if (text && text.length >= 12) return text;
  } catch (err) {
    console.warn(
      "[atilioDialogueCompose] compose failed:",
      err instanceof Error ? err.message : err,
    );
  }
  return fallback ?? input.dialogueState.hechos.join(" ");
}
