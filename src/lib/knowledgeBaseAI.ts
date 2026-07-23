import OpenAI from "openai";
import { OPENAI_DEFAULT_TIMEOUT_MS, withOpenAiTimeout } from "@/lib/openaiTimeout";
import { OPCIONES_KNOWLEDGE_BASE, UNIDADES_KNOWLEDGE_BASE } from "@/lib/knowledgeBase";
import { getBotPromptModule } from "@/lib/botPromptStore";

// El prompt de sistema incluye el manual completo (mucho más texto que el catálogo
// compacto de unidades), así que le damos algo más de margen que el timeout default
// para no caer al fallback estático por una demora de red normal.
const KNOWLEDGE_BASE_TIMEOUT_MS = OPENAI_DEFAULT_TIMEOUT_MS + 3_000;

export type KnowledgeGuideKind = "opciones" | "unidades";

const KNOWLEDGE_BY_KIND: Record<KnowledgeGuideKind, string> = {
  opciones: OPCIONES_KNOWLEDGE_BASE,
  unidades: UNIDADES_KNOWLEDGE_BASE,
};

// Clave del módulo en el panel "Configuración → Prompts por trámite" (tabla
// BotPromptModule). Estas instrucciones ya existían, escritas a mano con reglas
// estrictas (un bloque, máx. 8 pasos, no inventar botones, no repetir cierre) para el
// asistente ChatPDF de BuilderBot que quedó inutilizable al borrarse los flows (ver
// docs/bbc-flows-eliminados-2026-07-22.md). Se reutilizan acá como prompt real: así lo
// que se edite en ese panel vuelve a tener efecto en la respuesta real del bot.
const PROMPT_MODULE_KEY_BY_KIND: Record<KnowledgeGuideKind, string> = {
  opciones: "opciones_info",
  unidades: "unidades_info",
};

const FALLBACK_INSTRUCTIONS = `Sos Atilio, el asistente de soporte de Wara por WhatsApp. Respondé la pregunta del
cliente usando EXCLUSIVAMENTE la base de conocimiento provista abajo (manual real del módulo). No inventes
pasos, botones, nombres de pantallas ni funcionalidades que no estén en el manual.
- Español rioplatense, tono cordial y directo, formato de mensaje de WhatsApp (sin markdown pesado).
- Si la respuesta requiere pasos, numeralos brevemente. Total máximo ~6 líneas.
- Si el manual no cubre lo que pregunta, decilo con honestidad y sugerí la sección más cercana o que lo
  consulte con un administrador de la cuenta. NUNCA inventes información que no esté en el manual.`;

async function resolveInstructions(kind: KnowledgeGuideKind): Promise<string> {
  try {
    const moduleKey = PROMPT_MODULE_KEY_BY_KIND[kind];
    const module = await getBotPromptModule(moduleKey);
    const content = module?.content?.trim();
    // Placeholder sin editar (buildModulePlaceholder) no aporta nada específico del
    // módulo — mejor usar el fallback genérico que un texto vacío de instrucciones.
    if (content && content.length > 200) return content;
  } catch {
    // Sigue con el fallback genérico (DB caída, módulo no sembrado, etc).
  }
  return FALLBACK_INSTRUCTIONS;
}

/**
 * Responde preguntas de guía informativa (Opciones/Unidades) usando el manual real de
 * Wara como base de conocimiento, en vez de las plantillas fijas por palabra clave de
 * `@/lib/infoGuideReplies`. Las instrucciones de estilo/reglas vienen del mismo módulo
 * editable en Configuración → "Prompts por trámite" (tabla BotPromptModule), con
 * fallback genérico si no hay contenido cargado ahí. Devuelve null si no hay
 * OPENAI_API_KEY o si la IA falla/tarda — el caller SIEMPRE debe hacer fallback al texto
 * estático en ese caso, para no dejar al cliente sin respuesta.
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
  const instructions = await resolveInstructions(kind);

  const system = `${instructions}

BASE DE CONOCIMIENTO (manual real de Wara, módulo ${kind}) — usá EXCLUSIVAMENTE esto para el contenido, nunca inventes algo que no esté acá:
"""
${knowledge}
"""

Formato de salida: texto plano de WhatsApp (sin markdown pesado, sin asteriscos de negrita), listo para enviar directo al cliente. Las palabras "FIN", "TERMINÁ", "UN SOLO TURNO" y similares en las instrucciones de arriba son directivas internas sobre CUÁNDO PARAR DE GENERAR — NUNCA las escribas en la respuesta ni agregues metacomentarios sobre el formato o el prompt.`;

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
    // Salvaguarda: si el modelo igual ecoa la directiva interna "FIN" al final
    // (viene de las instrucciones del panel, pensadas para BuilderBot, no para
    // mostrarse al cliente), la recortamos.
    const cleaned = text?.replace(/\s*\bFIN\.?\s*$/i, "").trim();
    return cleaned || null;
  } catch {
    return null;
  }
}
