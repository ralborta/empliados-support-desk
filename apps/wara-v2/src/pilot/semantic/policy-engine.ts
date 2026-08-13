/**
 * Policy engine determinístico post-LLM.
 * Trabaja solo sobre TurnDecision + estado.
 * No clasifica intención por texto libre.
 *
 * Única excepción documentada: parsers de campo bajo expectedAnswerType
 * (numeric_value / date / time) — completan fields, no eligen trámite.
 */
import type { TurnDecision } from "./turn-decision-schema.js";
import {
  isStructuredAmend,
  isStructuredCompanyKeep,
  safeClarifyDecision,
} from "./turn-decision-schema.js";
import type { PilotConversationState } from "../conversation-state.js";
import {
  binaryClarifyForConflict,
  detectDecisionConflict,
  noteDecisionConflict,
} from "./decision-conflict.js";
import {
  DEFAULT_TENANT_TZ,
  reconcileLlmReadingFields,
  resolveNaturalReadingDatetime,
} from "./natural-datetime.js";
import { shouldUseCancelShortcut } from "./cancel-command.js";

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
  "query_active_company",
  "none",
]);

export type PolicyResult =
  | { ok: true; decision: TurnDecision }
  | { ok: false; decision: TurnDecision; reason: string };

export type PolicyOptions = {
  timezone?: string;
  /**
   * Solo para parsers de expectedField / reconcile de fecha ya decidida.
   * Nunca para inventar intent ni speechAct.
   */
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

function meterIntent(state: PilotConversationState): "odometer" | "horometer" {
  return state.odometerDraft?.meterType === "horometro" ? "horometer" : "odometer";
}

/** Intents que arrancan un servicio (no query/none). */
const STARTABLE_SERVICE_INTENTS = new Set([
  "certificate",
  "odometer",
  "horometer",
  "gps",
  "maintenance",
  "ticket",
  "human_handoff",
]);

function pendingImpliesIntent(state: PilotConversationState): string | null {
  const a = state.pendingConfirmation?.action;
  if (a === "odometer_write") {
    return state.odometerDraft?.meterType === "horometro" ? "horometer" : "odometer";
  }
  if (a === "certificate_issue") return "certificate";
  if (a === "gps_report") return "gps";
  if (a === "maintenance_write") return "maintenance";
  if (a === "odoo_ticket_create") return "ticket";
  if (state.activeTramite === "odometer_update") {
    return state.odometerDraft?.meterType === "horometro" ? "horometer" : "odometer";
  }
  if (state.activeTramite === "certificate_issue") return "certificate";
  if (state.activeTramite === "search_unit" || state.activeTramite === "unit_gps_report") {
    return "gps";
  }
  if (
    state.activeTramite === "maintenance_request" ||
    state.activeTramite === "maintenance_consult"
  ) {
    return "maintenance";
  }
  if (state.activeTramite === "odoo_ticket") return "ticket";
  return null;
}

/**
 * Consistencia estructural: intent de servicio + action=general no es ejecutable
 * (cae al menú y deja pending vivo). No lee el texto del usuario.
 * Preserva amend / negate / farewell / company actions.
 */
function coerceGeneralServiceStart(
  decision: TurnDecision,
  state: PilotConversationState,
): TurnDecision {
  if (decision.action !== "general") return decision;
  if (!STARTABLE_SERVICE_INTENTS.has(decision.intent)) return decision;
  if (
    decision.speechAct === "amend" ||
    decision.speechAct === "negate_intent" ||
    decision.speechAct === "farewell" ||
    decision.speechAct === "courtesy" ||
    decision.speechAct === "confirm" ||
    isStructuredAmend(decision) ||
    isStructuredCompanyKeep(decision)
  ) {
    return decision;
  }
  if (
    decision.companyAction === "query_active" ||
    decision.companyAction === "change" ||
    decision.companyAction === "select" ||
    decision.companyAction === "keep"
  ) {
    return decision;
  }

  const hasActive =
    Boolean(state.pendingConfirmation) ||
    (state.activeTramite != null && state.activeTramite !== "none");
  const currentIntent = pendingImpliesIntent(state);
  const intentDiffers = currentIntent != null && currentIntent !== decision.intent;
  const wantsService =
    decision.reasoningCode === "NEW_EXPLICIT_INTENT" ||
    decision.reasoningCode === "SWITCH_INTENT" ||
    decision.speechAct === "start_intent" ||
    decision.speechAct === "change_intent" ||
    decision.answer === "reject" ||
    decision.answer === "cancel" ||
    (Boolean(state.pendingConfirmation) && intentDiffers);

  if (!wantsService) return decision;

  return {
    ...decision,
    action: hasActive ? "switch_intent" : "start_intent",
    speechAct:
      decision.speechAct === "cancel" || decision.answer === "cancel"
        ? "cancel"
        : decision.speechAct === "change_intent"
          ? "change_intent"
          : "start_intent",
    currentTramiteDisposition: hasActive ? "cancel" : "keep",
    reasoningCode: hasActive ? "SWITCH_INTENT" : "NEW_EXPLICIT_INTENT",
    answer:
      hasActive && (decision.answer === "reject" || decision.answer === "cancel")
        ? "cancel"
        : decision.answer ?? null,
    ambiguity: null,
  };
}

/** Parser de campo: solo si el estado ya espera ese campo. */
function fillExpectedFieldsFromMessage(
  decision: TurnDecision,
  state: PilotConversationState,
  message: string,
  opts?: { timezone?: string; localNow?: string },
): TurnDecision {
  const expected = state.lastAgentQuestionMeta?.expectedAnswerType;
  if (!message.trim()) return decision;

  if (expected === "numeric_value" && state.odometerDraft?.step === "await_value") {
    const raw = message.trim();
    if (/^\d+([.,]\d+)?$/.test(raw)) {
      const n = Number(raw.replace(/\./g, "").replace(",", "."));
      if (Number.isFinite(n)) {
        return {
          ...decision,
          action: "provide_fields",
          intent: meterIntent(state),
          speechAct: "provide_field",
          currentTramiteDisposition: "keep",
          ambiguity: null,
          reasoningCode: "PROVIDED_MISSING_FIELD",
          fields: {
            ...(decision.fields ?? {}),
            numericValue: n,
            value: n,
          },
        };
      }
    }
  }

  if (
    (expected === "date" || expected === "time") &&
    state.odometerDraft?.step === "await_fecha" &&
    (decision.action === "clarify" ||
      decision.speechAct === "clarify" ||
      decision.action === "provide_fields" ||
      decision.action === "correct_fields" ||
      (!decision.fields?.date && !decision.fields?.time))
  ) {
    const resolved = resolveNaturalReadingDatetime(message, {
      timezone: opts?.timezone ?? DEFAULT_TENANT_TZ,
      localNow: opts?.localNow,
    });
    if (resolved.kind === "resolved" && (resolved.date || resolved.time)) {
      return {
        ...decision,
        action: "provide_fields",
        intent: meterIntent(state),
        speechAct: "provide_field",
        currentTramiteDisposition: "keep",
        ambiguity: null,
        reasoningCode: "PROVIDED_MISSING_FIELD",
        answer: null,
        fields: {
          ...(decision.fields ?? {}),
          date: resolved.date ?? decision.fields?.date ?? null,
          time: resolved.time ?? decision.fields?.time ?? null,
          numericValue: decision.fields?.numericValue ?? null,
        },
      };
    }
    // expected=time + "5" / "5:30" sueltos
    if (expected === "time") {
      const raw = message.trim();
      const bare = raw.match(/^(\d{1,2})(?::(\d{2}))?$/);
      if (bare) {
        const hh = Number(bare[1]);
        const mm = bare[2] ? Number(bare[2]) : 0;
        if (hh <= 23 && mm <= 59) {
          return {
            ...decision,
            action: "provide_fields",
            intent: meterIntent(state),
            speechAct: "provide_field",
            currentTramiteDisposition: "keep",
            ambiguity: null,
            reasoningCode: "PROVIDED_MISSING_FIELD",
            answer: null,
            fields: {
              ...(decision.fields ?? {}),
              date: decision.fields?.date ?? state.odometerDraft.fechaDatePart ?? null,
              time: `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`,
              numericValue: null,
            },
          };
        }
      }
    }
    if (
      decision.action === "clarify" ||
      decision.speechAct === "clarify" ||
      (!decision.fields?.date && !decision.fields?.time)
    ) {
      return {
        ...decision,
        action: "provide_fields",
        intent: meterIntent(state),
        speechAct: "provide_field",
        currentTramiteDisposition: "keep",
        ambiguity: null,
        reasoningCode: "PROVIDED_MISSING_FIELD",
        fields: decision.fields ?? { date: null, time: null, numericValue: null },
      };
    }
  }

  return decision;
}

/**
 * Cancel mal etiquetado cuando el mensaje es corrección de fecha/hora del resumen.
 * No lee intención libre: solo si hay pending de escritura + resolución natural de fecha
 * y NO es cancel inequívoco (veto de seguridad).
 */
function coerceCancelToOdometerFieldCorrection(
  decision: TurnDecision,
  state: PilotConversationState,
  message: string,
  opts?: { timezone?: string; localNow?: string },
): TurnDecision {
  const cancelSignal =
    decision.answer === "cancel" ||
    decision.speechAct === "cancel" ||
    decision.currentTramiteDisposition === "cancel" ||
    decision.disposition === "cancel_active";
  if (!cancelSignal) return decision;
  // Cancel inequívoco (veto de seguridad): no convertir en corrección.
  if (shouldUseCancelShortcut(message, state)) return decision;
  if (
    state.pendingConfirmation?.action !== "odometer_write" ||
    !state.odometerDraft ||
    state.odometerDraft.step === "idle"
  ) {
    return decision;
  }
  // Solo con resumen ya armado (hay fecha a corregir) o confirmación pendiente.
  const hasFecha =
    Boolean(state.odometerDraft.fechaDatePart) ||
    Boolean(state.odometerDraft.fechaLecturaIso) ||
    state.odometerDraft.step === "await_confirm";
  if (!hasFecha) return decision;

  const resolved = resolveNaturalReadingDatetime(message, {
    timezone: opts?.timezone ?? DEFAULT_TENANT_TZ,
    localNow: opts?.localNow,
  });
  if (resolved.kind !== "resolved" || !resolved.date) return decision;
  // Requiere ancla relativa/weekday/numérica (hoy, ayer, sábado, 13/08…)
  if (
    resolved.source !== "relative" &&
    resolved.source !== "weekday" &&
    resolved.source !== "numeric"
  ) {
    return decision;
  }

  const fieldsToClear: Array<"date" | "time"> = ["date"];
  if (resolved.time) fieldsToClear.push("time");

  return {
    ...decision,
    action: "correct_fields",
    intent: meterIntent(state),
    speechAct: "provide_field",
    currentTramiteDisposition: "keep",
    reasoningCode: "PROVIDED_MISSING_FIELD",
    answer: null,
    disposition: "keep_current",
    ambiguity: null,
    fields: {
      ...(decision.fields ?? {}),
      date: resolved.date,
      time: resolved.time,
      numericValue: null,
      timezone: opts?.timezone ?? DEFAULT_TENANT_TZ,
    },
    fieldsToClear,
  };
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

  // Intent de servicio con action=general → start/switch (antes de amend/company).
  decision = coerceGeneralServiceStart(decision, state);

  // Cancel mal etiquetado + fecha relativa del resumen → correct_fields (antes de honor cancel).
  decision = coerceCancelToOdometerFieldCorrection(decision, state, message, {
    timezone: tz,
    localNow: opts?.localNow,
  });

  // Amend vs cancel: mutuamente excluyentes. Conflicto → clarify (NO “amend gana siempre”).
  // Debe ir ANTES de normalizar keep+amend (esa normalización limpia answer/disposition).
  const cancelSignal =
    decision.answer === "cancel" ||
    decision.speechAct === "cancel" ||
    decision.disposition === "cancel_active" ||
    decision.currentTramiteDisposition === "cancel";
  if (decision.speechAct === "amend" && cancelSignal) {
    return {
      ok: false,
      reason: "decision_conflict:amend_vs_cancel",
      decision: safeClarifyDecision(
        "¿Querés cancelar el trámite o solo cambiar un dato (por ejemplo la unidad)?",
      ),
    };
  }

  // Captura de unidad ya abierta: entity / patente = completar slot, NO re-abrir amend.
  const awaitingUnit =
    Boolean(state.pendingEntityResolution) ||
    state.certificateDraft?.step === "await_unit" ||
    state.odometerDraft?.step === "await_unit" ||
    state.maintenanceDraft?.step === "await_unit";
  const entityValue =
    decision.entity?.value != null && String(decision.entity.value).trim()
      ? String(decision.entity.value).trim()
      : null;
  if (awaitingUnit && entityValue) {
    return {
      ok: true,
      decision: {
        ...decision,
        action: "select_entity",
        speechAct: "provide_field",
        amendTarget: null,
        answer: null,
        currentTramiteDisposition: "keep",
        ambiguity: null,
        reasoningCode: "PROVIDED_MISSING_FIELD",
        entity: decision.entity,
      },
    };
  }
  if (
    awaitingUnit &&
    decision.speechAct === "amend" &&
    decision.amendTarget === "unit" &&
    !entityValue
  ) {
    // Ya estamos pidiendo unidad: no invalidar de nuevo; repreguntar.
    const ask =
      state.lastAgentQuestion?.trim() ||
      "¿Qué patente o unidad buscás?";
    return {
      ok: false,
      reason: "amend_while_awaiting_unit",
      decision: safeClarifyDecision(ask),
    };
  }

  // Keep de empresa tipado. Si viene junto con amend, no reescribir speechAct (F5).
  if (isStructuredCompanyKeep(decision) && decision.speechAct !== "amend") {
    return {
      ok: true,
      decision: {
        ...decision,
        action: "general",
        intent: "query_active_company",
        currentTramiteDisposition: "keep",
        speechAct: "negate_intent",
        companyAction: "keep",
        negatedAction: "change_company",
        answer: null,
        ambiguity: null,
      },
    };
  }
  if (isStructuredCompanyKeep(decision) && decision.speechAct === "amend") {
    decision = {
      ...decision,
      companyAction: "keep",
      negatedAction: "change_company",
      currentTramiteDisposition: "keep",
      answer: null,
    };
  } else if (decision.companyAction === "keep") {
    // keep espurio (p.ej. sin change_company): descartar.
    decision = { ...decision, companyAction: null };
  }

  // Amend: modificar un slot del trámite activo — no confirm / no cancel.
  if (decision.speechAct === "amend") {
    if (!isStructuredAmend(decision)) {
      return {
        ok: false,
        reason: "amend_without_target",
        decision: safeClarifyDecision(
          "¿Qué querés modificar del trámite: unidad, valor, fecha, hora u otro dato?",
        ),
      };
    }
    return {
      ok: true,
      decision: {
        ...decision,
        action: "general",
        speechAct: "amend",
        amendTarget: decision.amendTarget,
        answer: null,
        currentTramiteDisposition: "keep",
        ambiguity: null,
        reasoningCode:
          decision.reasoningCode === "GENERAL_CONVERSATION" ||
          decision.reasoningCode === "AMBIGUOUS_NEGATION"
            ? "AMEND_PENDING_SLOT"
            : decision.reasoningCode,
      },
    };
  }
  if (decision.companyAction === "change") {
    return {
      ok: true,
      decision: {
        ...decision,
        action: "general",
        intent: "query_active_company",
        currentTramiteDisposition: "keep",
        speechAct: decision.speechAct ?? "change_intent",
        companyAction: "change",
        answer: null,
        ambiguity: null,
      },
    };
  }
  if (decision.companyAction === "select") {
    return {
      ok: true,
      decision: {
        ...decision,
        action: "general",
        intent: "query_active_company",
        currentTramiteDisposition: "keep",
        companyAction: "select",
        answer: null,
        ambiguity: null,
      },
    };
  }

  if (
    decision.companyAction === "query_active" ||
    (decision.intent === "query_active_company" &&
      (decision.companyAction === "query_active" ||
        decision.action === "query_context" ||
        decision.speechAct === "query_context" ||
        decision.companyReference === "active")) ||
    (decision.action === "query_context" &&
      decision.intent !== "unit_list" &&
      decision.intent !== "unit_search" &&
      decision.intent !== "gps" &&
      decision.intent !== "odometer" &&
      decision.intent !== "horometer" &&
      decision.intent !== "certificate" &&
      decision.intent !== "maintenance" &&
      decision.intent !== "ticket")
  ) {
    return {
      ok: true,
      decision: {
        ...decision,
        action: "query_context",
        intent: "query_active_company",
        currentTramiteDisposition: "keep",
        reasoningCode: "QUERY_CONTEXT",
        companyReference: decision.companyReference ?? "active",
        companyAction: decision.companyAction ?? "query_active",
        answer: null,
        domainQuestion: null,
        ambiguity: null,
      },
    };
  }

  // Parsers de expectedField (no routing de intención).
  decision = fillExpectedFieldsFromMessage(decision, state, message, {
    timezone: tz,
    localNow: opts?.localNow,
  });

  // Draft esperando valor/fecha: si ya hay fields, forzar provide_fields.
  if (
    state.odometerDraft?.step === "await_value" &&
    (decision.fields?.numericValue != null || decision.fields?.value != null)
  ) {
    decision = {
      ...decision,
      action: "provide_fields",
      intent: meterIntent(state),
      currentTramiteDisposition: "keep",
      ambiguity: null,
      reasoningCode: "PROVIDED_MISSING_FIELD",
      fields: {
        ...(decision.fields ?? {}),
        numericValue: decision.fields?.numericValue ?? decision.fields?.value ?? null,
      },
    };
  }
  if (
    state.odometerDraft?.step === "await_fecha" &&
    (decision.fields?.date || decision.fields?.time)
  ) {
    decision = {
      ...decision,
      action: "provide_fields",
      intent: meterIntent(state),
      currentTramiteDisposition: "keep",
      ambiguity: null,
      reasoningCode: "PROVIDED_MISSING_FIELD",
    };
  }

  if (
    (decision.speechAct === "farewell" || decision.speechAct === "courtesy") &&
    state.pendingConfirmation
  ) {
    const writePending =
      state.pendingConfirmation.action === "odoo_ticket_create" ||
      state.pendingConfirmation.action === "maintenance_write" ||
      state.pendingConfirmation.action === "odometer_write" ||
      state.pendingConfirmation.action === "certificate_issue";
    if (writePending) {
      return {
        ok: true,
        decision: {
          ...decision,
          action: "general",
          intent: "none",
          answer: null,
          currentTramiteDisposition: "cancel",
          reasoningCode: "GENERAL_CONVERSATION",
          ambiguity: null,
        },
      };
    }
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

  const conflict = detectDecisionConflict(decision, state);
  if (conflict) {
    return conflictClarify(state, conflict.reason);
  }

  const expected = state.lastAgentQuestionMeta?.expectedAnswerType;
  if (decision.action === "clarify") {
    if (!decision.ambiguity?.question?.trim()) {
      return { ok: false, reason: "clarify_without_question", decision: safeClarifyDecision() };
    }
    if (
      expected === "numeric_value" ||
      expected === "date" ||
      expected === "time" ||
      expected === "unit"
    ) {
      return {
        ok: false,
        reason: "clarify_while_expecting_field",
        decision: safeClarifyDecision(
          expected === "numeric_value"
            ? "Pasame el valor numérico de la lectura."
            : expected === "unit"
              ? "Decime la patente o el nombre de la unidad."
              : "¿Me pasás la fecha y hora de la lectura?",
        ),
      };
    }
    // Conservar la pregunta del LLM — sin reescribir a plantillas de descarte.
    return {
      ok: true,
      decision: {
        ...decision,
        answer: null,
        currentTramiteDisposition: "keep",
        ambiguity: {
          ...decision.ambiguity,
          question: decision.ambiguity.question.trim(),
        },
      },
    };
  }

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
    if (v.split(/\s+/).length > 3) {
      return {
        ok: false,
        reason: "entity_too_verbose",
        decision: safeClarifyDecision("¿Cuál es el prefijo o la patente exacta?"),
      };
    }
  }

  if (decision.fields?.date && !isValidDate(decision.fields.date)) {
    return {
      ok: false,
      reason: "invalid_date",
      decision: safeClarifyDecision("No pude validar esa fecha. ¿Me la decís de nuevo?"),
    };
  }
  if (decision.fields?.time && !isValidTime(decision.fields.time)) {
    return {
      ok: false,
      reason: "invalid_time",
      decision: safeClarifyDecision("No pude validar esa hora. Usá formato 11:30."),
    };
  }

  // Reconciliar fecha/hora solo si el LLM ya aportó fields de fecha/hora.
  if (
    message &&
    isMeterReadingContext(decision, state) &&
    (decision.action === "provide_fields" || decision.action === "correct_fields") &&
    (decision.fields?.date || decision.fields?.time)
  ) {
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
          reconciled.reason === "future_explicit"
            ? "future_date"
            : reconciled.reason === "needs_precision"
              ? "needs_time_precision"
              : "date_weekday_mismatch",
        decision: safeClarifyDecision(reconciled.question),
      };
    }
    const nextFields = {
      ...(decision.fields ?? {}),
      date: reconciled.date,
      time: reconciled.time,
      timezone: decision.fields?.timezone ?? tz,
    };
    if (reconciled.diagnosis.cause === "time_only") {
      nextFields.date = null;
    }
    decision = {
      ...decision,
      fields: nextFields,
    };
  } else if (decision.fields?.date && decision.action === "provide_fields") {
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
