import OpenAI from "openai";
import { OPENAI_DEFAULT_TIMEOUT_MS, withOpenAiTimeout } from "@/lib/openaiTimeout";
import { OPCIONES_KNOWLEDGE_BASE, UNIDADES_KNOWLEDGE_BASE } from "@/lib/knowledgeBase";
import { getBotPromptModule } from "@/lib/botPromptStore";
import { buildTransporteKnowledgeContext } from "@/lib/transportePublicoKnowledge";
import { buildCisternasKnowledgeContext } from "@/lib/cisternasKnowledge";
import { buildCombustibleKnowledgeContext } from "@/lib/combustibleKnowledge";
import { buildHojasRutaKnowledgeContext } from "@/lib/hojasRutaKnowledge";
import { buildMantenimientoKnowledgeContext } from "@/lib/mantenimientoKnowledge";
import type { InfoGuideNeed } from "@/lib/infoGuideInterpretAI";

// El prompt de sistema incluye el manual completo (mucho más texto que el catálogo
// compacto de unidades), así que le damos algo más de margen que el timeout default
// para no caer al fallback estático por una demora de red normal.
const KNOWLEDGE_BASE_TIMEOUT_MS = OPENAI_DEFAULT_TIMEOUT_MS + 3_000;

export type KnowledgeGuideKind =
  | "opciones"
  | "unidades"
  | "mantenimiento"
  | "transporte_publico"
  | "cisternas"
  | "combustible"
  | "hojas_de_ruta";

const KNOWLEDGE_BY_KIND: Record<"opciones" | "unidades", string> = {
  opciones: OPCIONES_KNOWLEDGE_BASE,
  unidades: UNIDADES_KNOWLEDGE_BASE,
};

// Clave del módulo en el panel "Configuración → Prompts por trámite" (tabla
// BotPromptModule). Estas instrucciones ya existían, escritas a mano con reglas
// estrictas (un bloque, máx. 8 pasos, no inventar botones, no repetir cierre) para el
// asistente ChatPDF de BuilderBot que quedó inutilizable al borrarse los flows (ver
// docs/bbc-flows-eliminados-2026-07-22.md). Se reutilizan acá como prompt real: así lo
// que se edite en ese panel vuelve a tener efecto en la respuesta real del bot.
const PROMPT_MODULE_KEY_BY_KIND: Partial<Record<KnowledgeGuideKind, string>> = {
  opciones: "opciones_info",
  unidades: "unidades_info",
  // mantenimiento: NO usar panel como fuente de hechos (blob viejo / menús).
  // El corpus mt-* + MANTENIMIENTO_HARD_CONSTRAINTS es la fuente de verdad.
  // transporte_publico / cisternas / combustible: sin módulo de panel → FALLBACK + reglas del kind.
};

const FALLBACK_INSTRUCTIONS = `Sos Kira, el asistente de soporte de Wara por WhatsApp. Respondé la pregunta del
cliente usando EXCLUSIVAMENTE la base de conocimiento provista abajo (manual real del módulo). No inventes
pasos, botones, nombres de pantallas ni funcionalidades que no estén en el manual.
- Español rioplatense, tono cordial y directo, formato de mensaje de WhatsApp (sin markdown pesado).
- Si la respuesta requiere pasos, numeralos brevemente. Total máximo ~10 líneas.
- Explicá CÓMO hacerlo en la app Wara. No ofrezcas programar ni registrar mantenimiento por WhatsApp.
- No abras ni ofrezcas ticket/asesor solo porque preguntaron por mantenimiento.
- Si el manual no cubre lo que pregunta, decilo con honestidad y sugerí la sección más cercana o que lo
  consulte con un administrador de la cuenta. NUNCA inventes información que no esté en el manual.`;

/** Prioridad sobre cualquier prompt del panel: evita menús que pierden el hilo. */
const MANTENIMIENTO_HARD_CONSTRAINTS = `
REGLAS DURAS para Mantenimiento (prioridad absoluta):
- Usá SOLO los artículos mt-* provistos. No inventes pantallas ni botones.
- Utilidades → Mantenimiento = SOLO catálogos (planes, correctivo, conceptos toma/deje). La operación diaria es Unidades (asignar) + Paneles (Tareas / OT / Toma y deje) + Informes.
- Si la pregunta es genérica («Mantenimiento», «cómo se usa», «cómo agendo») → entregá el mapa configuración vs operación + el flujo preventivo básico (no un menú).
- NUNCA preguntes primero «¿preventivo o correctivo?», «¿querés configurar?» ni ofrezcas menús vacíos.
- Solo especializá preventivo/correctivo/toma-deje/OT si el cliente lo pidió o los articleIds lo indican.
- No confundas con odómetro/horómetro. No digas que creaste/programaste algo en la cuenta.
- Forma según need; execute = límite de canal (mt-ejecucion-no-disponible).
- Respetá restrictions (pendientes §11): no afirmes lo no confirmado.
- “Contar a partir de la realización”: solo decí que el campo existe y que el significado exacto no está validado; NUNCA inventes definición.
- No afirmes que confirmar realización cierra la tarea, recalcula el próximo vencimiento ni que la OT queda FINALIZADA si hay restriction pendiente.`.trim();

const TRANSPORTE_HARD_CONSTRAINTS = `
REGLAS DURAS Transporte Público:
- Usá SOLO los artículos provistos. No inventes pantallas, botones ni causas cerradas.
- Forma según need: definition=breve; procedure=pasos pertinentes (no un manual entero);
  troubleshoot=comprobaciones como hipótesis; ambiguous=una pregunta; execute=explicá límite de canal.
- No presentes status future como disponible. Si status needs_validation, sé cauteloso.
- Respetá restrictions del artículo: no afirmes lo no confirmado.
- No profundices en login, permisos de perfil, backoffice inicial ni roles del ente; solo el límite
  indispensable y derivación.
- Continuá el hilo («eso», feriado, ya lo hice) sin repetir pasos ya dados.
- No pedís patente para una guía general de plataforma.
- Nunca digas que creaste/guardaste algo en la cuenta.`.trim();

const CISTERNAS_HARD_CONSTRAINTS = `
REGLAS DURAS Cisternas:
- Usá SOLO los artículos provistos. No inventes pantallas, columnas de informes ni validaciones no confirmadas.
- Cisterna = tanque de depósito/base. NO es el tanque de una unidad ni odómetro/horómetro.
- No afirmes edición/eliminación de cisternas, multi-selección en carga, ni columnas exactas de informes.
- Respetá restrictions (needs_validation): si preguntan eso, decí que el manual no lo confirma.
- Forma según need; execute=límite de canal. Nunca digas que creaste/guardaste en la cuenta.
- Continuá el hilo (carga vs medición, “eso”, litros) sin repetir todo el manual.`.trim();

const COMBUSTIBLE_HARD_CONSTRAINTS = `
REGLAS DURAS Combustible:
- Usá SOLO los artículos provistos. No inventes pantallas, columnas ni estados no confirmados.
- Combustible = tickets / validación / panel / informes de UNIDAD. NO es módulo Cisternas (depósito).
- No afirmes grilla de validación, etiqueta de agua detectada, % del panel ni columnas de sensor si hay restriction/pendiente.
- Respetá restrictions (§13 del relevamiento). Forma según need; execute=límite de canal.
- Nunca digas que cargaste tickets ni generaste informes en la cuenta.
- Continuá el hilo sin repetir todo el manual.`.trim();

const HOJAS_RUTA_HARD_CONSTRAINTS = `
REGLAS DURAS Hojas de ruta:
- Usá SOLO los artículos hr-* provistos. No inventes pantallas, botones ni significados no confirmados.
- Hojas de ruta = Utilidades → Hojas de ruta (listado, predefinidas, calendario, cargas/descargas de VIAJE, puntos/traza). NO es “hoja de turno” (Transporte Público / pasajeros).
- Gestión de cargas/descargas de viaje ≠ tickets Combustible de unidad ≠ Cisternas (depósito) ≠ Remitos/Stock.
- Respetá restrictions (§10): AE INICIO/FIN, Actualizar números, descarga remota, etc. Si preguntan el significado de una etiqueta pendiente, decí explícitamente que el manual/relevamiento NO lo confirma (pendiente de validación) — NUNCA inventes una definición.
- Forma según need; execute = límite de canal (hr-ejecucion-no-disponible).
- Nunca digas que creaste/pegaste/enviaste planificación en la cuenta.
- Continuá el hilo sin repetir todo el manual.`.trim();

function needStyleHint(need?: InfoGuideNeed | null): string {
  if (!need) return "";
  const map: Record<InfoGuideNeed, string> = {
    definition: "Forma: definición breve (sin lista larga de pasos).",
    procedure: "Forma: solo los pasos pertinentes a lo preguntado.",
    troubleshoot: "Forma: comprobaciones concretas; distinguí hipótesis de hechos.",
    execute: "Forma: reconocé el pedido de ejecución y el límite del canal; ofrecé guía o asesor.",
    ambiguous: "Forma: una sola pregunta puntual para precisar.",
  };
  return map[need];
}

async function resolveInstructions(kind: KnowledgeGuideKind): Promise<string> {
  try {
    const moduleKey = PROMPT_MODULE_KEY_BY_KIND[kind];
    if (moduleKey) {
      const module = await getBotPromptModule(moduleKey);
      const content = module?.content?.trim();
      // Placeholder sin editar (buildModulePlaceholder) no aporta nada específico del
      // módulo — mejor usar el fallback genérico que un texto vacío de instrucciones.
      if (content && content.length > 200) return content;
    }
  } catch {
    // Sigue con el fallback genérico (DB caída, módulo no sembrado, etc).
  }
  return FALLBACK_INSTRUCTIONS;
}

/**
 * Responde preguntas de guía informativa (Opciones/Unidades/Mantenimiento) usando el
 * manual/KB de Wara, en vez de plantillas fijas por palabra clave de
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
  opts?: {
    articleIds?: string[];
    need?: InfoGuideNeed | null;
  },
): Promise<string | null> {
  if (!process.env.OPENAI_API_KEY?.trim()) return null;
  if (!question.trim()) return null;
  if (kind === "cisternas") {
    const { isCisternasKbEnabled } = await import("@/lib/cisternasKnowledge");
    if (!isCisternasKbEnabled()) return null;
  }
  if (kind === "combustible") {
    const { isCombustibleKbEnabled } = await import("@/lib/combustibleKnowledge");
    if (!isCombustibleKbEnabled()) return null;
  }
  if (kind === "hojas_de_ruta") {
    const { isHojasRutaKbEnabled } = await import("@/lib/hojasRutaKnowledge");
    if (!isHojasRutaKbEnabled()) return null;
  }

  const knowledge =
    kind === "transporte_publico"
      ? buildTransporteKnowledgeContext(opts?.articleIds ?? [])
      : kind === "cisternas"
        ? buildCisternasKnowledgeContext(opts?.articleIds ?? [])
        : kind === "combustible"
          ? buildCombustibleKnowledgeContext(opts?.articleIds ?? [])
          : kind === "hojas_de_ruta"
            ? buildHojasRutaKnowledgeContext(opts?.articleIds ?? [])
            : kind === "mantenimiento"
              ? buildMantenimientoKnowledgeContext(opts?.articleIds ?? [])
              : KNOWLEDGE_BY_KIND[kind];
  if (!knowledge?.trim()) return null;

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const instructions = await resolveInstructions(kind);

  const hardConstraints =
    kind === "mantenimiento"
      ? `\n\n${MANTENIMIENTO_HARD_CONSTRAINTS}`
      : kind === "transporte_publico"
        ? `\n\n${TRANSPORTE_HARD_CONSTRAINTS}`
        : kind === "cisternas"
          ? `\n\n${CISTERNAS_HARD_CONSTRAINTS}`
          : kind === "combustible"
            ? `\n\n${COMBUSTIBLE_HARD_CONSTRAINTS}`
            : kind === "hojas_de_ruta"
              ? `\n\n${HOJAS_RUTA_HARD_CONSTRAINTS}`
              : "";
  const needHint = needStyleHint(opts?.need);

  const system = `${instructions}${hardConstraints}
${needHint ? `\n${needHint}` : ""}

BASE DE CONOCIMIENTO (manual real de Wara, módulo ${kind}) — usá EXCLUSIVAMENTE esto para el contenido, nunca inventes algo que no esté acá:
"""
${knowledge}
"""

Formato de salida: texto plano de WhatsApp (sin markdown pesado, sin asteriscos de negrita), listo para enviar directo al cliente. Las palabras "FIN", "TERMINÁ", "UN SOLO TURNO" y similares en las instrucciones de arriba son directivas internas sobre CUÁNDO PARAR DE GENERAR — NUNCA las escribas en la respuesta ni agregues metacomentarios sobre el formato o el prompt.`;

  const user = JSON.stringify({
    pregunta: question,
    historial_reciente: (threadText ?? "").slice(-1500),
    need: opts?.need ?? null,
    articleIds: opts?.articleIds ?? null,
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
