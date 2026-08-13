/**
 * Respuestas de guía de plataforma ancladas al manual real (IA).
 * Solo se invoca cuando TurnDecision ya eligió domain_knowledge + topic platform_*.
 * No clasifica intención por texto.
 */
import { FIXED_OPENAI_ENDPOINT } from "../../llm/flags.js";
import { authorizedOpenAiFetch } from "../../llm/network.js";
import { semanticModelName, semanticTimeoutMs } from "./brain-flags.js";
import {
  OPCIONES_KNOWLEDGE_BASE,
  UNIDADES_KNOWLEDGE_BASE,
} from "./platform-knowledge-base.js";

export type PlatformGuideKind = "opciones" | "unidades";

const KB: Record<PlatformGuideKind, string> = {
  opciones: OPCIONES_KNOWLEDGE_BASE,
  unidades: UNIDADES_KNOWLEDGE_BASE,
};

const SYSTEM_RULES = `Sos Atilio, soporte WARA por WhatsApp/lab (Argentina).
Respondé SOLO con información de la BASE DE CONOCIMIENTO abajo.
NO inventes botones, pantallas, pasos ni funciones que no estén en el manual.
Español rioplatense, cordial, mensaje corto de chat (máx ~8 líneas). Si hay pasos, numeralos.
Si el manual no cubre la pregunta, decilo y ofrecé derivar a un asesor.
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
  const knowledge = KB[input.kind];
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
  return null;
}

/** Fallback estático si la IA no responde — solo hechos del manual. */
export function platformStaticFallback(kind: PlatformGuideKind, question: string): string {
  const q = question
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (kind === "unidades") {
    if (/\bchevron\b/.test(q)) {
      return (
        "El chevron es la flecha a la derecha de cada fila de unidad en el módulo Unidades. " +
        "Al tocarlo se abre la ficha expandida con datos en tiempo real y MIS ATAJOS (Historial, Compartir, etc.)."
      );
    }
    if (/\bhistorial\b/.test(q)) {
      return (
        "Para ver el historial de una unidad: módulo Unidades (ícono del auto) → abrí la ficha con el chevron → MIS ATAJOS → HISTORIAL. " +
        "Ahí ves el recorrido en el mapa por fecha y hora."
      );
    }
    return (
      "El módulo Unidades (ícono del auto en la barra lateral) es el centro de la flota: grupos, puntos de estado (verde/azul/rojo), ficha expandida y MIS ATAJOS. " +
      "Decime qué querés hacer (historial, compartir posición, certificado, orden de trabajo) y te guío con los pasos."
    );
  }
  if (/\bagenda|contacto\b/.test(q)) {
    return (
      "La Agenda está en Utilidades → Opciones → Agenda. Ahí cargás contactos (mail/teléfono) y les asignás un Perfil. " +
      "Eso alimenta Notificaciones para saber a quién avisar."
    );
  }
  if (/\bnotific|alerta\b/.test(q)) {
    return (
      "Notificaciones (Opciones → Notificaciones) define: cuando una unidad hace X, avisale a Y por mail/app/Telegram. " +
      "Sin reglas configuradas el sistema registra eventos pero no alerta a nadie."
    );
  }
  return (
    "En Opciones tenés Agenda (contactos), Notificaciones (avisos automáticos) y Perfiles (permisos). " +
    "Decime cuál de los tres necesitás y te indico los pasos."
  );
}
