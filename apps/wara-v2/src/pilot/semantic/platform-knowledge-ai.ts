/**
 * Respuestas de guía de plataforma ancladas al manual real (IA).
 * Solo se invoca cuando TurnDecision ya eligió domain_knowledge + topic platform_*.
 * No clasifica intención por texto.
 */
import { FIXED_OPENAI_ENDPOINT } from "../../llm/flags.js";
import { authorizedOpenAiFetch } from "../../llm/network.js";
import { semanticModelName, semanticTimeoutMs } from "./brain-flags.js";
import { knowledgeForPlatformGuide } from "./platform-knowledge-base.js";
import {
  v1MantenimientoFallback,
  v1OpcionesFallback,
  v1UnidadesFallback,
} from "./v1-info-guides.js";

export type PlatformGuideKind = "opciones" | "unidades" | "mantenimiento";

const SYSTEM_RULES = `Sos Atilio, soporte WARA por WhatsApp/lab (Argentina).
Respondé SOLO con información de la BASE DE CONOCIMIENTO abajo.
NO inventes botones, pantallas, pasos ni funciones que no estén en el manual.
Español rioplatense, cordial. Un único bloque: 1 línea de intro + lista numerada (máx 8 pasos).
La base incluye TODO lo de V1: PDF Opciones, PDF Unidades, plantillas de Opciones/Unidades/Mantenimiento y how-to operativo (preventivo, correctivo, consumo/rendimiento, ficha de una unidad).
El módulo de Mantenimiento ESTÁ en esta base. NUNCA digas que no tenés información sobre ese módulo.
Si preguntan cómo hacerlo con una unidad específica: chevron de esa unidad → MIS ATAJOS → Tareas correctivas o Agregar orden de trabajo (y/o asociar esa unidad en Mantenimiento).
Respondé ÚNICAMENTE lo preguntado; no mezcles otros módulos.
NO pidas patente ni abras ticket por una duda de cómo usar el panel.
Solo derivá a un asesor si piden algo claramente fuera de esta base (precios, admin, hardware).
Nunca escribas metacomentarios ni la palabra FIN.`;

export async function answerFromPlatformKnowledge(input: {
  kind: PlatformGuideKind;
  question: string;
  recentTurns?: Array<{ role: string; text: string }>;
  env?: NodeJS.ProcessEnv;
}): Promise<string | null> {
  const env = input.env ?? process.env;
  const apiKey = env.OPENAI_API_KEY?.trim() ?? "";
  if (!apiKey || !input.question.trim()) return null;
  const knowledge = knowledgeForPlatformGuide(input.kind);
  if (!knowledge) return null;

  const model = semanticModelName(env);
  const timeoutMs = Math.min(semanticTimeoutMs(env) + 3000, 25_000);
  const history = (input.recentTurns ?? [])
    .slice(-6)
    .map((t) => `${t.role}: ${t.text}`)
    .join("\n")
    .slice(-1500);

  const system = `${SYSTEM_RULES}

BASE DE CONOCIMIENTO (manual módulo ${input.kind}):
"""
${knowledge}
"""`;

  const user = JSON.stringify({
    pregunta: input.question,
    historial_reciente: history,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const result = await authorizedOpenAiFetch(FIXED_OPENAI_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 450,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      signal: controller.signal,
      timeoutMs,
    });
    if (result.status < 200 || result.status >= 300) return null;
    const parsed = JSON.parse(result.text) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = parsed.choices?.[0]?.message?.content?.trim();
    const cleaned = text?.replace(/\s*\bFIN\.?\s*$/i, "").trim();
    return cleaned || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function platformKindFromTopic(
  topic: string | null | undefined,
): PlatformGuideKind | null {
  if (topic === "platform_unidades") return "unidades";
  if (topic === "platform_opciones") return "opciones";
  if (topic === "platform_mantenimiento") return "mantenimiento";
  return null;
}

/** La IA a veces niega el módulo aunque la base sí lo cubre. */
export function isPlatformKnowledgeRefusal(text: string): boolean {
  const t = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (/\d+\.\s/.test(text) && text.length > 160) return false;
  return (
    /no tengo informacion/.test(t) ||
    /no (hay|encontre|encuentro) informacion/.test(t) ||
    (/puedo derivarte a un asesor/.test(t) && !/chevron|atajo|mantenimiento cubre/i.test(text))
  );
}

export function resolvePlatformGuideAnswer(
  ai: string | null,
  kind: PlatformGuideKind,
  question: string,
): string {
  if (ai && !isPlatformKnowledgeRefusal(ai)) return ai;
  return platformStaticFallback(kind, question);
}

/** Fallback estático V1 si la IA no responde — nunca deja al cliente sin guía. */
export function platformStaticFallback(kind: PlatformGuideKind, question: string): string {
  if (kind === "unidades") return v1UnidadesFallback(question);
  if (kind === "mantenimiento") return v1MantenimientoFallback(question);
  return v1OpcionesFallback(question);
}
