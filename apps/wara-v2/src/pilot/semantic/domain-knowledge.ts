/**
 * Conocimiento de dominio WARA controlado (versionado).
 * No inventa funciones; responde desde catálogo aprobado + contexto del trámite.
 */
import type { PilotConversationState } from "../conversation-state.js";
import type { TurnDecision } from "./turn-decision-schema.js";
import {
  answerFromPlatformKnowledge,
  platformKindFromTopic,
  platformStaticFallback,
} from "./platform-knowledge-ai.js";

export const DOMAIN_KNOWLEDGE_VERSION = "v2-2026-08-13-platform";

export type DomainTopic =
  | "odometer"
  | "horometer"
  | "gps"
  | "certificate"
  | "maintenance"
  | "ticket"
  | "unit"
  | "wara"
  | "platform_unidades"
  | "platform_opciones"
  | "other_supported"
  | "out_of_domain";

export type DomainQuestionType =
  | "definition"
  | "purpose"
  | "how_it_works"
  | "why_needed"
  | "required_data"
  | "consequence"
  | "status_explanation"
  | "capabilities"
  | "comparison";

export type DomainConcept = {
  definition: string;
  unit?: string;
  uses: string[];
  notes?: string[];
};

/** Catálogo aprobado — no afirmar políticas fuera de esto. */
export const DOMAIN_KNOWLEDGE: Record<
  Exclude<
    DomainTopic,
    "out_of_domain" | "other_supported" | "platform_unidades" | "platform_opciones"
  >,
  DomainConcept
> = {
  odometer: {
    definition:
      "El odómetro registra la distancia total recorrida por el vehículo, normalmente en kilómetros.",
    unit: "kilómetros",
    uses: [
      "mantener actualizado el kilometraje de la unidad",
      "seguimiento operativo",
      "referencia para planes de mantenimiento",
      "corregir desvíos respecto del valor del GPS",
    ],
    notes: [
      "En WARA se usa para registrar el kilometraje real cuando no coincide con el del equipo.",
      "No es un mantenimiento en sí: es una actualización del dato operativo.",
    ],
  },
  horometer: {
    definition:
      "El horómetro registra el tiempo acumulado de funcionamiento del motor o equipo, normalmente en horas.",
    unit: "horas",
    uses: [
      "actualizar horas de motor cuando el GPS no coincide",
      "alinear planes de mantenimiento por horas",
      "reportes operativos",
    ],
  },
  gps: {
    definition:
      "El reporte GPS muestra el estado reciente de la unidad: posición, ignición y último reporte.",
    uses: [
      "ubicarlo en el mapa",
      "ver si está en movimiento o detenido",
      "chequear frescura del último reporte",
    ],
    notes: [
      "«Último reporte» indica hace cuánto la unidad envió datos al sistema.",
    ],
  },
  certificate: {
    definition:
      "El certificado de cobertura es el documento que acredita la cobertura de la unidad en WARA.",
    uses: ["solicitarlo para una patente/unidad concreta", "gestión administrativa de flota"],
  },
  maintenance: {
    definition:
      "La solicitud de mantenimiento registra un pedido de service o reparación sobre una unidad.",
    uses: ["abrir un pedido con detalle y prioridad", "derivarlo al equipo operativo"],
  },
  ticket: {
    definition:
      "Un ticket deriva el caso a un asesor humano (Odoo) cuando hace falta intervención personal.",
    uses: ["reclamos", "casos que el bot no puede cerrar", "escalamiento"],
    notes: [
      "Al derivarte, un operador retoma el hilo con el motivo que cargaste; el bot no ejecuta el caso solo.",
    ],
  },
  unit: {
    definition:
      "Una unidad es un móvil de la flota identificado por patente y/o nombre interno (código).",
    uses: ["consultas GPS", "lecturas", "certificados", "mantenimiento"],
  },
  wara: {
    definition:
      "WARA es la plataforma de gestión de flota: unidades, GPS, lecturas, certificados y soporte.",
    uses: [
      "reporte GPS / estado de unidad",
      "actualizar odómetro u horómetro",
      "certificado de cobertura",
      "solicitud de mantenimiento",
      "derivación a asesor (ticket)",
      "buscar o listar unidades",
      "guías del módulo Unidades (historial, MIS ATAJOS, chevron)",
      "guías de Opciones (Agenda, Notificaciones, Perfiles)",
    ],
  },
};

const DATE_WHY =
  "La fecha y hora identifican cuándo se tomó la lectura. Así el historial queda ordenado y no se confunde con otra carga.";

const BAD_KM =
  "Si el kilometraje está mal, conviene corregirlo antes de confirmar. Un valor incorrecto afecta el seguimiento y los mantenimientos.";

export function summarizePendingTramite(state: PilotConversationState): string | null {
  const pc = state.pendingConfirmation;
  if (pc?.action === "odometer_write" && state.odometerDraft) {
    const d = state.odometerDraft;
    const label = d.meterType === "horometro" ? "horómetro" : "odómetro";
    const unit = d.unit?.label ?? state.selectedUnit?.label ?? "la unidad";
    const val = d.valueNew != null ? String(d.valueNew) : "—";
    const when =
      d.fechaDisplay ??
      (d.fechaDatePart && d.fechaTimePart
        ? `${d.fechaDatePart.split("-").reverse().join("/")} ${d.fechaTimePart}`
        : d.fechaLecturaIso ?? "sin fecha");
    return `Tenías pendiente registrar ${val}${d.meterType === "horometro" ? " hs" : " km"} de ${label} para ${unit} con fecha ${when}.`;
  }
  if (pc?.action === "certificate_issue") {
    const unit = pc.unit?.label ?? state.selectedUnit?.label ?? "la unidad";
    return `Tenías pendiente el certificado de cobertura de ${unit}.`;
  }
  if (pc?.action === "gps_report") {
    const unit = pc.unit?.label ?? state.selectedUnit?.label ?? "la unidad";
    return `Tenías pendiente el reporte GPS de ${unit}.`;
  }
  if (pc?.action === "maintenance_write") {
    const unit = pc.unit?.label ?? state.selectedUnit?.label ?? "la unidad";
    return `Tenías pendiente la solicitud de mantenimiento de ${unit}.`;
  }
  if (pc?.action === "odoo_ticket_create") {
    return "Tenías pendiente la derivación a un asesor.";
  }
  if (state.odometerDraft && state.odometerDraft.step !== "idle") {
    const d = state.odometerDraft;
    const label = d.meterType === "horometro" ? "horómetro" : "odómetro";
    return `Seguíamos con la actualización de ${label}${d.unit?.label ? ` de ${d.unit.label}` : ""}.`;
  }
  if (state.certificateDraft && state.certificateDraft.step !== "idle") {
    return "Seguíamos con la solicitud de certificado.";
  }
  if (state.maintenanceDraft && state.maintenanceDraft.step !== "idle") {
    return "Seguíamos con la solicitud de mantenimiento.";
  }
  return null;
}

function norm(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/** Señal genérica de pregunta conceptual / explicación (no una frase fija). */
export function looksLikeDomainQuestion(text: string): boolean {
  const t = norm(text).trim();
  if (!t || t.length > 220) return false;
  if (
    /^(si|sip|dale|ok|listo|confirmo|cancelar|continuar|continuemos|sigamos)\b/.test(t)
  ) {
    return false;
  }
  return (
    /\b(para\s+que\s+sirve|para\s+q\s+sirve|que\s+es|que\s+significa|por\s+que|porque|como\s+funciona|que\s+diferencia|que\s+pasa\s+si|que\s+datos|que\s+necesitas|que\s+necesitás|para\s+que\s+piden|para\s+que\s+necesitan|para\s+que\s+me\s+pedis|para\s+que\s+me\s+pedís|explicame|explicá|explica|que\s+certificado|que\s+cosas\s+podes|que\s+cosas\s+podés|que\s+podes\s+hacer|que\s+podés\s+hacer|que\s+servicios)\b/.test(
      t,
    ) ||
    /\b(sirve|significa|diferencia)\b/.test(t)
  );
}

export function looksLikeCapabilitiesQuestion(text: string): boolean {
  const t = norm(text);
  return /\b(que\s+(cosas\s+)?(podes|podés|puedes)\s+hacer|que\s+servicios|en\s+que\s+me\s+ayudas|capacidades|menu\s+de\s+opciones)\b/.test(
    t,
  );
}

export function looksLikeOutOfDomainQuestion(text: string): boolean {
  const t = norm(text);
  if (!/\?|quien|quién|como|cómo|donde|dónde|cuando|cuándo|que|qué/.test(text) && t.length < 8) {
    return false;
  }
  return /\b(mundial|fifa|partido|clima|pronostico|pronóstico|receta|chiste|bitcoin|cripto|elecciones|politica|política|futbol|fútbol|messi|pelicula|película|netflix)\b/.test(
    t,
  );
}

export function inferDomainTopic(
  text: string,
  state: PilotConversationState,
): DomainTopic {
  const t = norm(text);
  if (looksLikeOutOfDomainQuestion(text)) return "out_of_domain";
  if (looksLikeCapabilitiesQuestion(text)) return "wara";
  if (/\bhor[oó]metro|horas\s+de\s+motor\b/.test(t) && !/\bod[oó]metro|kilometr/.test(t)) {
    return "horometer";
  }
  if (/\bod[oó]metro|kilometr|km\b/.test(t)) return "odometer";
  if (/\bcertificado|cobertura|poliza|póliza\b/.test(t)) return "certificate";
  if (/\bmantenimiento|service|taller\b/.test(t)) return "maintenance";
  if (/\bgps|ubicacion|ubicación|posicion|posición|ultimo\s+reporte|último\s+reporte\b/.test(t)) {
    return "gps";
  }
  if (/\bticket|asesor|deriv|reclamo\b/.test(t)) return "ticket";
  // Guías de plataforma (manual): solo como fallback de topic si el LLM ya eligió dominio.
  if (
    /\b(mis\s+atajos|chevron|ficha\s+expandida|modulo\s+unidades|punto\s+(rojo|verde|azul)|compartir\s+posicion|orden\s+de\s+trabajo)\b/.test(
      t,
    ) ||
    (/\b(como|donde|que\s+es|como\s+hago|pasos)\b/.test(t) &&
      /\b(historial|mapa|grupo\s+de\s+unidades|panel)\b/.test(t))
  ) {
    return "platform_unidades";
  }
  if (
    /\b(modulo\s+opciones|agenda|notificaciones|perfiles|perfil\s+de\s+permisos)\b/.test(t) ||
    (/\b(como|donde|que\s+es)\b/.test(t) && /\b(contacto|alerta|permisos)\b/.test(t))
  ) {
    return "platform_opciones";
  }
  if (/\bunidad|patente|flota\b/.test(t)) return "unit";
  if (/\bfecha|hora\b/.test(t) && state.odometerDraft) {
    return state.odometerDraft.meterType === "horometro" ? "horometer" : "odometer";
  }
  // Contexto del trámite activo si la pregunta es abstracta ("para qué sirve").
  if (state.odometerDraft?.meterType === "horometro") return "horometer";
  if (state.odometerDraft) return "odometer";
  if (state.certificateDraft || state.pendingConfirmation?.action === "certificate_issue") {
    return "certificate";
  }
  if (state.maintenanceDraft) return "maintenance";
  if (state.pendingConfirmation?.action === "gps_report") return "gps";
  if (state.ticketDraft) return "ticket";
  if (/\bwara|sistema\b/.test(t)) return "wara";
  return "other_supported";
}

export function inferQuestionType(text: string): DomainQuestionType {
  const t = norm(text);
  if (looksLikeCapabilitiesQuestion(text)) return "capabilities";
  if (/\bdiferencia\b/.test(t)) return "comparison";
  if (/\bque\s+pasa\s+si|mal|incorrect|error\b/.test(t)) return "consequence";
  if (/\bpor\s+que|porque|para\s+que\s+(me\s+)?(piden|necesitan|pedis|pedís)|fecha|hora\b/.test(t)) {
    if (/\bfecha|hora\b/.test(t)) return "why_needed";
  }
  if (/\bdatos|necesitas|necesitás|pedir\b/.test(t)) return "required_data";
  if (/\bcomo\s+funciona|como\s+se\s+usa\b/.test(t)) return "how_it_works";
  if (/\bpara\s+q(ue)?\s+sirve|sirve\b/.test(t)) return "purpose";
  if (/\bque\s+es|que\s+significa|definic\b/.test(t)) return "definition";
  if (/\bultimo\s+reporte|último\s+reporte|estado\b/.test(t)) return "status_explanation";
  return "purpose";
}

function conceptBody(topic: DomainTopic, qType: DomainQuestionType, text: string): string {
  if (topic === "out_of_domain") {
    return "Estoy para ayudarte con tus unidades y servicios de WARA.";
  }
  if (qType === "capabilities" || topic === "wara") {
    const uses = DOMAIN_KNOWLEDGE.wara.uses.map((u) => `• ${u}`).join("\n");
    return `Puedo ayudarte con:\n${uses}`;
  }

  const key =
    topic === "other_supported"
      ? null
      : (topic as keyof typeof DOMAIN_KNOWLEDGE);
  if (!key || !(key in DOMAIN_KNOWLEDGE)) {
    return "No tengo confirmado ese detalle. Puedo derivarlo a un asesor si hace falta.";
  }
  const c = DOMAIN_KNOWLEDGE[key];
  const t = norm(text);

  if (qType === "comparison" && (topic === "odometer" || topic === "horometer")) {
    return (
      `${DOMAIN_KNOWLEDGE.odometer.definition} Se mide en ${DOMAIN_KNOWLEDGE.odometer.unit}.\n` +
      `${DOMAIN_KNOWLEDGE.horometer.definition} Se mide en ${DOMAIN_KNOWLEDGE.horometer.unit}.\n` +
      `En resumen: odómetro = distancia; horómetro = tiempo de uso del motor/equipo.`
    );
  }

  if (/\bfecha|hora\b/.test(t) && (topic === "odometer" || topic === "horometer")) {
    return DATE_WHY;
  }
  if (qType === "consequence" && (topic === "odometer" || topic === "horometer")) {
    return BAD_KM;
  }
  if (qType === "required_data") {
    if (topic === "odometer") {
      return "Para actualizar el odómetro necesito: unidad (patente), valor en km, fecha y hora de la lectura.";
    }
    if (topic === "horometer") {
      return "Para actualizar el horómetro necesito: unidad, valor en horas, fecha y hora de la lectura.";
    }
    if (topic === "certificate") return "Para el certificado necesito la unidad (patente).";
    if (topic === "maintenance") {
      return "Para mantenimiento necesito la unidad y un detalle de qué necesita.";
    }
    if (topic === "ticket") return "Para derivarte necesito un motivo breve del caso.";
    if (topic === "gps") return "Para el reporte GPS necesito la unidad.";
  }

  if (qType === "status_explanation" && topic === "gps") {
    return (
      c.notes?.[0] ??
      "«Último reporte» indica hace cuánto la unidad envió datos al sistema."
    );
  }

  const uses = c.uses.length ? ` En WARA se usa para ${c.uses.slice(0, 3).join(", ")}.` : "";
  const unit = c.unit ? ` Se expresa en ${c.unit}.` : "";
  const note = c.notes?.[0] ? ` ${c.notes[0]}` : "";
  if (qType === "definition") return `${c.definition}${unit}${note}`.trim();
  if (qType === "purpose" || qType === "how_it_works" || qType === "why_needed") {
    return `${c.definition}${unit}${uses}${note}`.trim();
  }
  return `${c.definition}${unit}${uses}`.trim();
}

export type DomainAnswerResult = {
  message: string;
  topic: DomainTopic;
  questionType: DomainQuestionType;
  handler: "domain_knowledge" | "domain_out_of_scope" | "capabilities";
};

/**
 * Responde pregunta de dominio sin mutar el trámite.
 * Topics platform_* → IA anclada al manual (con fallback estático).
 */
export async function answerDomainQuestion(
  state: PilotConversationState,
  text: string,
  domainQuestion?: TurnDecision["domainQuestion"] | null,
  opts?: {
    env?: NodeJS.ProcessEnv;
    recentTurns?: Array<{ role: string; text: string }>;
  },
): Promise<DomainAnswerResult> {
  const topic = domainQuestion?.topic ?? inferDomainTopic(text, state);
  const questionType =
    domainQuestion?.questionType ??
    (topic === "wara" && looksLikeCapabilitiesQuestion(text)
      ? "capabilities"
      : inferQuestionType(text));
  const resume =
    domainQuestion?.resumeActiveTramite ??
    Boolean(
      state.pendingConfirmation ||
        (state.odometerDraft && state.odometerDraft.step !== "idle") ||
        (state.certificateDraft && state.certificateDraft.step !== "idle") ||
        (state.maintenanceDraft && state.maintenanceDraft.step !== "idle"),
    );

  const platformKind = platformKindFromTopic(topic);
  let body: string;
  if (platformKind) {
    const ai = await answerFromPlatformKnowledge({
      kind: platformKind,
      question: text,
      recentTurns: opts?.recentTurns ?? state.recentTurns,
      env: opts?.env,
    });
    body = ai ?? platformStaticFallback(platformKind, text);
  } else {
    body = conceptBody(topic, questionType, text);
  }

  const pending = resume ? summarizePendingTramite(state) : null;

  let tail = "";
  if (topic === "out_of_domain") {
    tail = pending
      ? `\n\n${pending} ¿Querés continuar o corregir algún dato?`
      : "\n\nSi necesitás algo de tu flota en WARA, decime.";
    return {
      message: `${body}${tail}`,
      topic,
      questionType,
      handler: "domain_out_of_scope",
    };
  }

  if (pending) {
    tail = `\n\n${pending} ¿Querés continuar o corregir algún dato?`;
  } else if (
    questionType !== "capabilities" &&
    topic !== "wara" &&
    !platformKind
  ) {
    tail = "\n\n¿Querés que te ayude a realizar ese trámite?";
  }

  return {
    message: `${body}${tail}`,
    topic,
    questionType,
    handler: questionType === "capabilities" ? "capabilities" : "domain_knowledge",
  };
}

/** Reescribe general → answer_domain_question cuando el mensaje es conceptual. */
export function maybeRewriteGeneralToDomain(
  decision: TurnDecision,
  message: string,
  state: PilotConversationState,
): TurnDecision {
  if (decision.action === "answer_domain_question" || decision.intent === "domain_knowledge") {
    return {
      ...decision,
      action: "answer_domain_question",
      intent: "domain_knowledge",
      currentTramiteDisposition: "keep",
      reasoningCode: "DOMAIN_QUESTION",
      domainQuestion: decision.domainQuestion ?? {
        topic: inferDomainTopic(message, state),
        questionType: inferQuestionType(message),
        resumeActiveTramite: Boolean(
          state.pendingConfirmation ||
            (state.odometerDraft && state.odometerDraft.step !== "idle"),
        ),
      },
    };
  }

  if (decision.action !== "general") return decision;

  if (looksLikeOutOfDomainQuestion(message)) {
    return {
      action: "answer_domain_question",
      intent: "domain_knowledge",
      confidence: Math.max(decision.confidence, 0.7),
      currentTramiteDisposition: "keep",
      reasoningCode: "DOMAIN_QUESTION",
      answer: null,
      entity: null,
      fields: null,
      fieldsToClear: null,
      ambiguity: null,
      domainQuestion: {
        topic: "out_of_domain",
        questionType: "definition",
        resumeActiveTramite: Boolean(state.pendingConfirmation || state.odometerDraft),
      },
    };
  }

  if (looksLikeCapabilitiesQuestion(message) || looksLikeDomainQuestion(message)) {
    const topic = inferDomainTopic(message, state);
    return {
      action: "answer_domain_question",
      intent: "domain_knowledge",
      confidence: Math.max(decision.confidence, 0.75),
      currentTramiteDisposition: "keep",
      reasoningCode: "DOMAIN_QUESTION",
      answer: null,
      entity: null,
      fields: null,
      fieldsToClear: null,
      ambiguity: null,
      domainQuestion: {
        topic,
        questionType: inferQuestionType(message),
        resumeActiveTramite: Boolean(
          state.pendingConfirmation ||
            (state.odometerDraft && state.odometerDraft.step !== "idle"),
        ),
      },
    };
  }

  return decision;
}
