import OpenAI from "openai";
import { OPENAI_DEFAULT_TIMEOUT_MS, withOpenAiTimeout } from "@/lib/openaiTimeout";
import { OPCIONES_KNOWLEDGE_BASE, UNIDADES_KNOWLEDGE_BASE } from "@/lib/knowledgeBase";

// El prompt de sistema incluye el manual completo (mucho más texto que el catálogo
// compacto de unidades), así que le damos algo más de margen que el timeout default
// para no caer al fallback estático por una demora de red normal.
const KNOWLEDGE_BASE_TIMEOUT_MS = OPENAI_DEFAULT_TIMEOUT_MS + 3_000;

export type KnowledgeGuideKind = "opciones" | "unidades";

const KNOWLEDGE_BY_KIND: Record<KnowledgeGuideKind, string> = {
  opciones: OPCIONES_KNOWLEDGE_BASE,
  unidades: UNIDADES_KNOWLEDGE_BASE,
};

/**
 * Responde preguntas de guía informativa (Opciones/Unidades) usando el manual real de
 * Wara como base de conocimiento, en vez de las plantillas fijas por palabra clave de
 * `@/lib/infoGuideReplies`. Devuelve null si no hay OPENAI_API_KEY o si la IA falla/tarda
 * — el caller SIEMPRE debe hacer fallback al texto estático en ese caso, para no dejar
 * al cliente sin respuesta.
 */
export async function answerFromKnowledgeBase(
  kind: KnowledgeGuideKind,
  question: string,
  threadText?: string,
): Promise<string | null> {
  if (!process.env.OPENAI_API_KEY?.trim()) return null;
  const knowledge = KNOWLEDGE_BY_KIND[kind];
  if (!knowledge || !question.trim()) return null;

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const system = `Sos Atilio, el asistente de soporte de Wara por WhatsApp. Respondé la pregunta del cliente
usando EXCLUSIVAMENTE la base de conocimiento provista abajo (manual real del módulo). No inventes pasos,
botones, nombres de pantallas ni funcionalidades que no estén en el manual.

Reglas:
- Español rioplatense, tono cordial y directo, formato de mensaje de WhatsApp (sin markdown pesado, sin asteriscos de negrita).
- Si la respuesta requiere pasos, numeralos brevemente. Total máximo ~6 líneas.
- Si el manual no cubre lo que pregunta, decilo con honestidad ("no tengo ese detalle en la guía de Wara...") y sugerí la sección más cercana del manual o que lo consulte con un administrador de la cuenta. NUNCA inventes información que no esté en el manual.
- No copies párrafos enteros literalmente; resumí con tus propias palabras, específico a lo que preguntó.
- No repitas saludos ni uses firma; es un mensaje directo de WhatsApp.

BASE DE CONOCIMIENTO (manual real de Wara, módulo ${kind}):
"""
${knowledge}
"""`;

  const user = JSON.stringify({
    pregunta: question,
    historial_reciente: (threadText ?? "").slice(-1500),
  });

  try {
    const response = await withOpenAiTimeout((signal) =>
      openai.chat.completions.create(
        {
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          temperature: 0.2,
          max_tokens: 400,
        },
        { signal },
      ),
      KNOWLEDGE_BASE_TIMEOUT_MS,
    );
    if (!response) return null;
    const text = response.choices[0]?.message?.content?.trim();
    return text || null;
  } catch {
    return null;
  }
}
