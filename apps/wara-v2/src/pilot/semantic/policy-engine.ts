/**
 * Policy engine determinístico post-LLM.
 * Acepta / pide aclaración / bloquea. NO reclasifica lenguaje.
 */
import type { TurnDecision } from "./turn-decision-schema.js";
import { safeClarifyDecision } from "./turn-decision-schema.js";
import type { PilotConversationState } from "../conversation-state.js";
import { isCompoundCancelContinueQuestion } from "./cancel-command.js";
import {
  binaryClarifyForConflict,
  detectDecisionConflict,
  noteDecisionConflict,
} from "./decision-conflict.js";
import {
  DEFAULT_TENANT_TZ,
  reconcileLlmReadingFields,
} from "./natural-datetime.js";
import { maybeRewriteGeneralToDomain } from "./domain-knowledge.js";
import {
  looksLikeUnitCorrection,
  looksLikeUnitStatusOfActive,
} from "./unit-context.js";

const CAPABILITIES = new Set([
  "unit_list",
  "unit_search",
  "gps",
  "odometer",
  "horometer",
  "maintenance",
  "certificate",
  "ticket",
  "human_handoff",
  "domain_knowledge",
  "none",
]);

export type PolicyResult =
  | { ok: true; decision: TurnDecision }
  | { ok: false; decision: TurnDecision; reason: string };

export type PolicyOptions = {
  timezone?: string;
  message?: string;
  localNow?: string;
};

function isValidDate(iso: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) && !Number.isNaN(Date.parse(`${iso}T12:00:00`));
}

function isValidTime(t: string): boolean {
  return /^([01]?\d|2[0-3]):[0-5]\d$/.test(t.trim());
}

function conflictClarify(state: PilotConversationState, reason: string): PolicyResult {
  noteDecisionConflict(reason);
  return {
    ok: false,
    reason: `decision_conflict:${reason}`,
    decision: safeClarifyDecision(binaryClarifyForConflict(state)),
  };
}

function isMeterReadingContext(decision: TurnDecision, state: PilotConversationState): boolean {
  return (
    decision.intent === "odometer" ||
    decision.intent === "horometer" ||
    state.activeTramite === "odometer_update" ||
    Boolean(state.odometerDraft && state.odometerDraft.step !== "idle")
  );
}

export function applySemanticPolicy(
  decision: TurnDecision,
  state: PilotConversationState,
  opts?: PolicyOptions,
): PolicyResult {
  const tz = opts?.timezone ?? DEFAULT_TENANT_TZ;
  const message = opts?.message ?? "";

  if (!CAPABILITIES.has(decision.intent)) {
    return {
      ok: false,
      reason: "unknown_capability",
      decision: safeClarifyDecision("Ese servicio no está disponible. ¿Qué necesitás?"),
    };
  }

  // Preguntas conceptuales: no deben caer en menú general.
  decision = maybeRewriteGeneralToDomain(decision, message, state);

  // Estado de la unidad activa → GPS, no unit_list masivo.
  if (
    state.selectedUnit &&
    looksLikeUnitStatusOfActive(message) &&
    (decision.intent === "unit_list" ||
      decision.action === "start_intent" ||
      decision.action === "general")
  ) {
    decision = {
      ...decision,
      action: "start_intent",
      intent: "gps",
      currentTramiteDisposition: "keep",
      reasoningCode: "CONTEXTUAL_REFERENCE",
      entity: {
        type: "contextual",
        reference: "selected_unit",
        value: null,
        matchMode: null,
      },
    };
  }

  // Corrección de unidad → select_entity contextual previous.
  if (looksLikeUnitCorrection(message) && decision.action !== "answer_pending") {
    decision = {
      ...decision,
      action: "select_entity",
      intent: decision.intent === "none" ? "unit_search" : decision.intent,
      currentTramiteDisposition: "keep",
      reasoningCode: "CONTEXTUAL_REFERENCE",
      entity: {
        type: "contextual",
        reference: "previous_selected_unit",
        value: null,
        matchMode: null,
      },
      answer: null,
      ambiguity: null,
    };
  }

  // «la misma» mal tipada como index → contextual selected (nunca índice 1).
  if (
    decision.action === "select_entity" &&
    decision.entity?.type === "index" &&
    (/\b(misma|esa|seleccionada|anterior)\b/i.test(message) ||
      decision.reasoningCode === "CONTEXTUAL_REFERENCE")
  ) {
    decision = {
      ...decision,
      entity: {
        type: "contextual",
        reference: /\b(anterior|tenia|tenía|de\s+antes)\b/i.test(message)
          ? "previous_selected_unit"
          : "selected_unit",
        value: null,
        matchMode: null,
      },
      reasoningCode: "CONTEXTUAL_REFERENCE",
      currentTramiteDisposition: "keep",
    };
  }

  if (decision.action === "answer_domain_question" || decision.intent === "domain_knowledge") {
    return {
      ok: true,
      decision: {
        ...decision,
        action: "answer_domain_question",
        intent: "domain_knowledge",
        currentTramiteDisposition: "keep",
        reasoningCode: "DOMAIN_QUESTION",
        answer: null,
      },
    };
  }

  // Conflictos contradictorios: no ejecutar / no confirmar / no modificar.
  const conflict = detectDecisionConflict(decision, state);
  if (conflict) {
    return conflictClarify(state, conflict.reason);
  }

  if (decision.action === "clarify") {
    if (!decision.ambiguity?.question?.trim()) {
      return { ok: false, reason: "clarify_without_question", decision: safeClarifyDecision() };
    }
    let question = decision.ambiguity.question.trim();
    // Nunca ofrecer pregunta compuesta cancelar/continuar: sí queda ambiguo.
    if (isCompoundCancelContinueQuestion(question)) {
      const aboutCert =
        /\bcertificado\b/i.test(question) ||
        state.pendingConfirmation?.action === "certificate_issue" ||
        state.activeTramite === "certificate_issue";
      question = aboutCert
        ? "¿Querés cancelar la solicitud del certificado?"
        : "¿Querés cancelar el trámite pendiente?";
    }
    return {
      ok: true,
      decision: {
        ...decision,
        answer: null,
        currentTramiteDisposition: "keep",
        ambiguity: { ...decision.ambiguity, question },
      },
    };
  }

  // Normalizar: disposition cancel + answer ausente ⇒ answer cancel.
  if (
    decision.action === "answer_pending" &&
    decision.currentTramiteDisposition === "cancel" &&
    (decision.answer == null || decision.answer === undefined)
  ) {
    return {
      ok: true,
      decision: { ...decision, answer: "cancel" },
    };
  }

  // No reiniciar el mismo trámite pendiente vía switch/start.
  if (
    (decision.action === "switch_intent" ||
      decision.action === "suspend_and_start" ||
      decision.action === "start_intent") &&
    decision.intent === "certificate" &&
    (state.pendingConfirmation?.action === "certificate_issue" ||
      state.activeTramite === "certificate_issue")
  ) {
    return {
      ok: true,
      decision: {
        action: "clarify",
        intent: "certificate",
        confidence: Math.min(decision.confidence, 0.6),
        currentTramiteDisposition: "keep",
        reasoningCode: "INSUFFICIENT_CONTEXT",
        ambiguity: {
          candidates: ["cancelar_certificado", "continuar_certificado"],
          question: "¿Querés cancelar la solicitud del certificado?",
        },
        answer: null,
        entity: null,
        fields: null,
        fieldsToClear: null,
      },
    };
  }

  if (
    (decision.action === "switch_intent" ||
      decision.action === "suspend_and_start" ||
      decision.action === "start_intent") &&
    decision.intent === "none"
  ) {
    return {
      ok: false,
      reason: "start_without_intent",
      decision: safeClarifyDecision("¿Qué servicio querés iniciar?"),
    };
  }

  if (decision.entity?.type === "plate" || decision.entity?.type === "unit_name") {
    const v = decision.entity.value?.trim() ?? "";
    if (!v || v.length > 40) {
      return {
        ok: false,
        reason: "entity_invalid",
        decision: safeClarifyDecision("¿Me pasás la patente o el nombre de la unidad?"),
      };
    }
    if (/\s/.test(v) && v.split(/\s+/).length > 3) {
      return {
        ok: false,
        reason: "entity_too_verbose",
        decision: safeClarifyDecision("¿Cuál es el prefijo o la patente exacta?"),
      };
    }
  }

  if (decision.fields?.date) {
    if (!isValidDate(decision.fields.date)) {
      return {
        ok: false,
        reason: "invalid_date",
        decision: safeClarifyDecision("No pude validar esa fecha. ¿Me la decís de nuevo?"),
      };
    }
  }
  if (decision.fields?.time) {
    if (!isValidTime(decision.fields.time)) {
      return {
        ok: false,
        reason: "invalid_time",
        decision: safeClarifyDecision("No pude validar esa hora. Usá formato 11:30."),
      };
    }
  }

  // Validación determinística de fechas naturales (weekday / futuro / ejemplo inducido).
  if (
    message &&
    isMeterReadingContext(decision, state) &&
    (decision.action === "provide_fields" ||
      decision.action === "correct_fields" ||
      (decision.action === "answer_pending" && (decision.fields?.date || decision.fields?.time)))
  ) {
    const hasDateSignal =
      Boolean(decision.fields?.date) ||
      Boolean(decision.fields?.time) ||
      /\b(hoy|ayer|anteayer|domingo|lunes|martes|miercoles|miércoles|jueves|viernes|sabado|sábado|\d{1,2}\/\d{1,2}\/\d{2,4}|tipo\s+\d)\b/i.test(
        message,
      );
    if (hasDateSignal) {
      const reconciled = reconcileLlmReadingFields({
        message,
        timezone: tz,
        localNow: opts?.localNow,
        llmDate: decision.fields?.date,
        llmTime: decision.fields?.time,
      });
      if (!reconciled.ok) {
        return {
          ok: false,
          reason:
            reconciled.reason === "future_explicit" ? "future_date" : "date_weekday_mismatch",
          decision: safeClarifyDecision(reconciled.question),
        };
      }
      const nextFields = {
        ...(decision.fields ?? {}),
        date: reconciled.date,
        time: reconciled.time,
        timezone: decision.fields?.timezone ?? tz,
      };
      // time_only: no inventar date; dejar null para que execute conserve draft.
      if (reconciled.diagnosis.cause === "time_only") {
        nextFields.date = null;
      }
      decision = {
        ...decision,
        fields: nextFields,
        action:
          decision.action === "answer_pending" && (reconciled.date || reconciled.time)
            ? "provide_fields"
            : decision.action,
      };
    }
  } else if (decision.fields?.date && decision.action === "provide_fields") {
    // Fallback legacy sin mensaje: solo snap futuro en lecturas.
    const today = new Date().toLocaleDateString("en-CA", { timeZone: tz });
    if (decision.fields.date > today && isMeterReadingContext(decision, state)) {
      const [y, m, d] = decision.fields.date.split("-").map(Number);
      const dt = new Date(Date.UTC(y!, m! - 1, d!));
      dt.setUTCDate(dt.getUTCDate() - 7);
      const snapped = dt.toISOString().slice(0, 10);
      if (snapped <= today) {
        return {
          ok: true,
          decision: {
            ...decision,
            fields: { ...decision.fields, date: snapped, timezone: decision.fields.timezone ?? tz },
          },
        };
      }
      return {
        ok: false,
        reason: "future_date",
        decision: safeClarifyDecision(
          `La fecha ${decision.fields.date} parece futura. ¿Es correcta o preferís otra?`,
        ),
      };
    }
  }

  if (decision.action === "answer_pending" && !state.pendingConfirmation) {
    if (decision.answer === "confirm" || decision.answer === "reject") {
      return {
        ok: false,
        reason: "no_pending_confirmation",
        decision: safeClarifyDecision("No tengo una confirmación pendiente. ¿Qué necesitás?"),
      };
    }
  }

  return { ok: true, decision };
}
