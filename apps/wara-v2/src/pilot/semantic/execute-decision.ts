/**
 * Ejecución de TurnDecision — handlers sin reclasificar el texto libre.
 * El mensaje original solo se usa si la decisión ya aportó entity/fields.
 */
import type { PilotConversationState } from "../conversation-state.js";
import {
  clearOperationalTramite,
  resumeSuspendedTramite,
  suspendTramiteForSideQuery,
} from "../conversation-state.js";
import type { TurnDecision } from "./turn-decision-schema.js";
import {
  buildPaginatedListing,
  findUnitInFleetByRef,
  formatPaginatedFleetMessage,
  formatUnitLabel,
  isFleetListingBody,
  resolveUnitByNameFromFleet,
  resolveUnitByPlateFromFleet,
  toFleetUnitRef,
  unitAwaitAskMessage,
  type PaginatedFleetListing,
} from "../unit-fleet.js";
import { buildGpsReportForUnit } from "../gps-core.js";
import { executeUnitSearch } from "../unit-search-resolver.js";
import type { UnitSearchInterpretation } from "../unit-search-semantics.js";
import type { WaraUnidadEstado } from "../wara-types.js";
import { mergeFechaConHoraSuelt } from "../odometro-fecha.js";
import type { OdometerDraft } from "../odometer-types.js";
import {
  validateReading,
  validateNoRetroceso,
  formatFechaDiaLargo,
  formatFechaDisplay,
} from "../odometer-core.js";
import { tryResolveOdometerTurn } from "../odometer-turn.js";
import { tryResolveCertificateTurn } from "../certificate-turn.js";
import { tryResolveMaintenanceTurn } from "../maintenance-turn.js";
import { tryResolveTicketTurn } from "../ticket-turn.js";
import {
  CANCEL_CERT_REPLY,
  COMPOUND_CHOICE_REPLY,
  isBinaryCancelQuestion,
  isCompoundCancelContinueQuestion,
} from "./cancel-command.js";
import { cancelActiveOrPendingTramite, hasCancellableTramite } from "./cancel-active-tramite.js";
import { FECHA_LECTURA_QUESTION } from "./natural-datetime.js";
import {
  planAskMissingField,
  planOrchestrationClarify,
  renderResponsePlan,
} from "./response-plan.js";
import {
  assertStructuredWriteConfirmation,
  bindPendingConfirmationQuestion,
  clearLastAgentQuestion,
  DISCARD_OR_EDIT_QUESTION,
  inferExpectedAnswerTypeFromQuestion,
  mustBlockWriteExecution,
  replyActiveCompany,
  setLastAgentQuestion,
} from "./turn-precedence.js";
import { setExpectedField } from "./conversation-reduce.js";
import {
  formatAnomalyQuestion,
  isAnomalousReading,
} from "./reading-anomaly.js";
import type { ClearableField } from "./field-correction.js";
import {
  continueAfterUnitResolved,
  createPendingEntityResolution,
  ensurePendingForAwaitingUnit,
  resolveParentIntentForUnitSelection,
  touchPendingSearch,
} from "./pending-entity-resolution.js";
import {
  answerDomainQuestion,
} from "./domain-knowledge.js";
import {
  applyResolvedUnit,
  commitSelectedUnit,
  confirmProposedUnit,
  proposeUnit,
  resolveContextualUnitReference,
} from "./unit-context.js";

export type ExecuteDeps = {
  messageId: string;
  env: NodeJS.ProcessEnv;
  fleetUnits: WaraUnidadEstado[];
  /** Texto original solo para atajos ya autorizados por la decisión (p.ej. detalle libre). */
  originalMessage: string;
  showListing: (state: PilotConversationState, listing: PaginatedFleetListing, message: string) => void;
  askGpsConfirmation: (state: PilotConversationState, unit: WaraUnidadEstado) => string;
  deliverGpsReport: (state: PilotConversationState, unit: WaraUnidadEstado) => string;
  handleGpsSideQuery: (input: {
    state: PilotConversationState;
    text: string;
    fleetUnits: WaraUnidadEstado[];
    activeUnitRef: PilotConversationState["selectedUnit"];
    entity?: TurnDecision["entity"];
  }) => Promise<{ message: string; state: PilotConversationState }>;
};

export type ExecuteResult = {
  message: string;
  state: PilotConversationState;
  handler: string;
};

const TZ = "America/Argentina/Buenos_Aires";

function resolveAwaitUnitAsk(
  state: PilotConversationState,
  parent: ReturnType<typeof resolveParentIntentForUnitSelection>,
): string {
  const q = state.lastAgentQuestion?.trim();
  if (q && !isFleetListingBody(q)) return q;
  return unitAwaitAskMessage(parent);
}

function emptyOdoDraft(meterType: "odometro" | "horometro"): OdometerDraft {
  return {
    meterType,
    unit: null,
    valueNew: null,
    valuePrevious: null,
    anomalyCandidate: null,
    fechaLecturaIso: null,
    fechaDisplay: null,
    fechaDatePart: null,
    fechaTimePart: null,
    step: "idle",
  };
}

function buildOdometerConfirmQuestion(draft: OdometerDraft): string {
  const meterType = draft.meterType ?? "odometro";
  const unit = draft.unit!;
  const suffix = meterType === "horometro" ? " hs" : " km";
  return (
    `Voy a registrar en WARA:\n` +
    `• ${unit.label}\n` +
    `• ${meterType === "horometro" ? "Horómetro" : "Odómetro"}: ${draft.valueNew}${suffix}\n` +
    (draft.valuePrevious != null ? `• Anterior: ${draft.valuePrevious}${suffix}\n` : "") +
    `• Fecha: ${draft.fechaDisplay}\n` +
    `Si está correcto, respondé CONFIRMO.`
  );
}

function setOdometerConfirm(state: PilotConversationState, draft: OdometerDraft, question: string): void {
  draft.step = "await_confirm";
  const prev = state.pendingConfirmation;
  state.pendingConfirmation = {
    action: "odometer_write",
    unit: draft.unit!,
    askedAt: new Date().toISOString(),
    question,
    operationId: prev?.operationId,
    version: (prev?.version ?? 0) + 1,
  };
  bindPendingConfirmationQuestion(state, question, "confirm_odometer_write");
}

/** Adjunta unidad al draft de odómetro (start / await_unit). */
function bindUnitToOdometerDraft(
  draft: OdometerDraft,
  state: PilotConversationState,
  unit: WaraUnidadEstado,
): void {
  const ref = toFleetUnitRef(unit);
  draft.unit = ref;
  state.selectedUnit = ref;
  draft.valuePrevious =
    draft.meterType === "horometro" ? (unit.horometro ?? null) : (unit.odometro ?? null);
  draft.step = "await_value";
}

function resolveUnitFromDecisionOrText(
  decision: TurnDecision,
  deps: ExecuteDeps,
  opts?: { allowMessageAsUnitField?: boolean },
): WaraUnidadEstado | null {
  // Preferir entity estructurada; si falta y estamos en expected unit, parsear del mensaje.
  // Siempre probar patente Y nombre/código (el usuario no solo manda patentes).
  const raw =
    decision.entity?.value?.trim() ||
    (opts?.allowMessageAsUnitField ? deps.originalMessage.trim() : "");
  if (!raw) return null;
  const preferName =
    decision.entity?.type === "unit_name" || decision.entity?.type === "contextual";
  if (preferName) {
    const byName = resolveUnitByNameFromFleet(deps.fleetUnits, raw);
    if (byName.kind === "one") return byName.unit;
    const byPlate = resolveUnitByPlateFromFleet(deps.fleetUnits, raw);
    if (byPlate.kind === "one") return byPlate.unit;
    return null;
  }
  const byPlate = resolveUnitByPlateFromFleet(deps.fleetUnits, raw);
  if (byPlate.kind === "one") return byPlate.unit;
  const byName = resolveUnitByNameFromFleet(deps.fleetUnits, raw);
  if (byName.kind === "one") return byName.unit;
  return null;
}

function handleCorrectOdometerFields(
  decision: TurnDecision,
  state: PilotConversationState,
  deps: ExecuteDeps,
): ExecuteResult | null {
  const draft = state.odometerDraft;
  if (!draft || draft.step === "idle") return null;
  const clear = new Set<ClearableField>(
    (decision.fieldsToClear ?? []).filter(Boolean) as ClearableField[],
  );
  const fields = decision.fields ?? {};
  const beforeFecha = draft.fechaDisplay;
  const kept: string[] = [];
  if (draft.unit) kept.push(`la unidad ${draft.unit.label}`);
  if (draft.meterType) kept.push(draft.meterType === "horometro" ? "el horómetro" : "el odómetro");
  if (draft.valueNew != null && !clear.has("numericValue")) {
    kept.push(`el valor ${draft.valueNew}${draft.meterType === "horometro" ? " hs" : " km"}`);
  }
  if (draft.fechaTimePart && !clear.has("time") && clear.has("date")) {
    kept.push(`la hora ${draft.fechaTimePart.slice(0, 5)}`);
  }
  if (draft.fechaDatePart && !clear.has("date") && clear.has("time")) {
    kept.push(`la fecha ${draft.fechaDatePart}`);
  }

  if (clear.has("date") || clear.has("time")) {
    // En WARA fecha+hora van juntas al registrar; al corregir fecha pedimos ambas si se borró date.
    if (clear.has("date")) {
      draft.fechaDatePart = null;
      draft.fechaLecturaIso = null;
      draft.fechaDisplay = null;
      if (!clear.has("time") && draft.fechaTimePart) {
        // conservar hora
      } else if (clear.has("time")) {
        draft.fechaTimePart = null;
      }
    }
    if (clear.has("time") && !clear.has("date")) {
      draft.fechaTimePart = null;
      if (draft.fechaLecturaIso) {
        draft.fechaLecturaIso = `${draft.fechaLecturaIso.slice(0, 10)}T00:00:00`;
        draft.fechaDisplay = formatFechaDisplay(draft.fechaLecturaIso);
      }
    }
    state.pendingConfirmation = null;
    draft.step = "await_fecha";
  }
  if (clear.has("numericValue")) {
    draft.valueNew = null;
    draft.anomalyCandidate = null;
    state.pendingConfirmation = null;
    draft.step = "await_value";
  }
  if (clear.has("unit")) {
    draft.unit = null;
    state.pendingConfirmation = null;
    draft.step = "await_unit";
  }

  // Aplicar valores de reemplazo si vinieron.
  if (fields.numericValue != null) {
    draft.valueNew = fields.numericValue;
    draft.anomalyCandidate = null;
  }
  if (fields.date || fields.time) {
    const date = fields.date ?? draft.fechaDatePart;
    const time = fields.time ?? (draft.fechaTimePart ? draft.fechaTimePart.slice(0, 5) : null);
    if (date && time) {
      const merged = `${date}T${time.length === 5 ? time + ":00" : time}`;
      draft.fechaLecturaIso = merged;
      draft.fechaDisplay = formatFechaDisplay(merged);
      draft.fechaDatePart = date;
      draft.fechaTimePart = merged.slice(11, 19);
      if (!draft.unit) {
        draft.step = "await_unit";
        return {
          handler: "odometer",
          message: `Anoté ${draft.fechaDisplay}. Decime la patente para el ${draft.meterType === "horometro" ? "horómetro" : "odómetro"}.`,
          state,
        };
      }
      if (draft.valueNew == null) {
        draft.step = "await_value";
        return {
          handler: "odometer",
          message: `Anoté ${draft.fechaDisplay}. Pasame el valor del ${draft.meterType === "horometro" ? "horómetro (hs)" : "odómetro (km)"}.`,
          state,
        };
      }
      let q = buildOdometerConfirmQuestion(draft);
      if (beforeFecha && beforeFecha !== draft.fechaDisplay) {
        q =
          `Corregí la fecha:\n` +
          `Antes: ${beforeFecha}\n` +
          `Ahora: ${draft.fechaDisplay}\n\n` +
          q;
      }
      setOdometerConfirm(state, draft, q);
      return { handler: "odometer", message: q, state };
    } else if (date && !time) {
      draft.fechaDatePart = date;
      draft.fechaLecturaIso = `${date}T00:00:00`;
      draft.fechaDisplay = formatFechaDisplay(draft.fechaLecturaIso);
      const dd = date.slice(8, 10);
      const mm = date.slice(5, 7);
      const yyyy = date.slice(0, 4);
      const message = `Entendido: ${dd}/${mm}/${yyyy}. ¿A qué hora fue?`;
      setExpectedField(state, {
        text: message,
        purpose: "ask_time",
        expectedAnswerType: "time",
      });
      return {
        handler: "odometer",
        message,
        state,
      };
    } else if (time && !date) {
      draft.fechaTimePart = `${time.length === 5 ? time : time}:00`.slice(0, 8);
      return {
        handler: "odometer",
        message: renderResponsePlan(
          planAskMissingField({
            received: `Perfecto, ya tengo la hora (${time}).`,
            missing: "fecha",
            question: "¿De qué día es la lectura?",
          }),
        ),
        state,
      };
    }
  }

  if (clear.has("numericValue") && fields.numericValue == null) {
    return {
      handler: "odometer",
      message: `De acuerdo. Mantengo ${kept.filter((k) => !k.includes("valor")).join(", ") || "el resto"}. ¿Cuál es el valor correcto?`,
      state,
    };
  }

  if (clear.has("date") && !fields.date) {
    const keptMsg =
      kept.length > 0
        ? ` Mantengo ${kept.join(", ")}.`
        : "";
    // Fecha y hora suelen ser inseparables al corregir el día.
    if (draft.fechaTimePart) {
      return {
        handler: "odometer",
        message: `De acuerdo.${keptMsg} ¿Qué fecha correcta querés registrar?`,
        state,
      };
    }
    return {
      handler: "odometer",
      message: `Perfecto, corrijamos la fecha y hora.${keptMsg} ¿Cuáles son las correctas?`,
      state,
    };
  }

  if (clear.has("time") && !fields.time) {
    return {
      handler: "odometer",
      message: `De acuerdo.${kept.length ? ` Mantengo ${kept.join(", ")}.` : ""} ¿Qué hora correcta querés registrar?`,
      state,
    };
  }

  return {
    handler: "odometer",
    message: "De acuerdo, ¿qué dato querés corregir?",
    state,
  };
}

function handleProvideOdometerFields(
  decision: TurnDecision,
  state: PilotConversationState,
  deps: ExecuteDeps,
): ExecuteResult | null {
  const draft = state.odometerDraft;
  if (!draft || draft.step === "idle") return null;

  if (decision.action === "correct_fields") {
    return handleCorrectOdometerFields(decision, state, deps);
  }

  const fields = decision.fields ?? {};
  const meterType = draft.meterType ?? (decision.intent === "horometer" ? "horometro" : "odometro");
  draft.meterType = meterType;

  // Patente / unidad mientras falta unidad en el draft (expected field unit).
  if (draft.step === "await_unit") {
    const unit = resolveUnitFromDecisionOrText(decision, deps, { allowMessageAsUnitField: true });
    if (unit) {
      bindUnitToOdometerDraft(draft, state, unit);
      state.pendingEntityResolution = null;
      if (fields.numericValue == null) {
        const ask = `Pasame el valor del ${meterType === "horometro" ? "horómetro (hs)" : "odómetro (km)"}.`;
        setExpectedField(state, {
          text: ask,
          purpose: "ask_odometer_value",
          expectedAnswerType: "numeric_value",
        });
        return {
          handler: "odometer",
          message: ask,
          state,
        };
      }
    } else {
      const ask = `Decime la patente para el ${meterType === "horometro" ? "horómetro" : "odómetro"}.`;
      setExpectedField(state, {
        text: ask,
        purpose: "ask_unit",
        expectedAnswerType: "unit",
      });
      return { handler: "odometer", message: ask, state };
    }
  }

  // Confirmación reforzada de valor anómalo — solo decisión estructurada.
  if (draft.step === "await_anomaly_confirm") {
    if (decision.answer === "confirm") {
      draft.valueNew = draft.anomalyCandidate ?? draft.valueNew;
      draft.anomalyCandidate = null;
      draft.step = "await_fecha";
      setExpectedField(state, {
        text: FECHA_LECTURA_QUESTION,
        purpose: "ask_datetime",
        expectedAnswerType: "date",
      });
      return { handler: "odometer", message: FECHA_LECTURA_QUESTION, state };
    }
    if (decision.answer === "reject" || decision.answer === "cancel") {
      draft.anomalyCandidate = null;
      draft.valueNew = null;
      draft.step = "await_value";
      const ask = `Ok, descarté ese valor. Pasame el ${meterType === "horometro" ? "horómetro (hs)" : "odómetro (km)"} correcto.`;
      setExpectedField(state, {
        text: ask,
        purpose: "ask_odometer_value",
        expectedAnswerType: "numeric_value",
      });
      return {
        handler: "odometer",
        message: ask,
        state,
      };
    }
    return {
      handler: "odometer",
      message: formatAnomalyQuestion(draft.anomalyCandidate ?? draft.valueNew ?? 0, meterType),
      state,
    };
  }

  if (fields.numericValue != null && draft.step === "await_value") {
    const val = validateReading(fields.numericValue, meterType, { explicitInMessage: true });
    if (!val.ok) return { handler: "odometer", message: val.reason, state };
    const retro = validateNoRetroceso(fields.numericValue, draft.valuePrevious);
    if (!retro.ok) return { handler: "odometer", message: retro.reason, state };
    if (
      isAnomalousReading({
        valueNew: fields.numericValue,
        valuePrevious: draft.valuePrevious,
        meterType,
        env: deps?.env,
      })
    ) {
      draft.anomalyCandidate = fields.numericValue;
      draft.step = "await_anomaly_confirm";
      state.pendingConfirmation = null;
      return {
        handler: "odometer",
        message: formatAnomalyQuestion(fields.numericValue, meterType),
        state,
      };
    }
    draft.valueNew = fields.numericValue;
    draft.anomalyCandidate = null;
    draft.step = "await_fecha";
    setExpectedField(state, {
      text: FECHA_LECTURA_QUESTION,
      purpose: "ask_datetime",
      expectedAnswerType: "date",
    });
    return {
      handler: "odometer",
      message: FECHA_LECTURA_QUESTION,
      state,
    };
  }

  if (draft.step === "await_fecha" || draft.step === "await_confirm") {
    // Solo hora — conservar fecha del draft
    if (fields.time && !fields.date) {
      const time = fields.time.trim();
      if (draft.fechaDatePart || (draft.fechaLecturaIso && draft.fechaLecturaIso.length >= 10)) {
        const base =
          draft.fechaLecturaIso ??
          (draft.fechaDatePart ? `${draft.fechaDatePart}T00:00:00` : null);
        const merged = mergeFechaConHoraSuelt(base, time, TZ);
        if (merged) {
          draft.fechaLecturaIso = merged;
          draft.fechaDisplay = formatFechaDisplay(merged);
          draft.fechaDatePart = merged.slice(0, 10);
          draft.fechaTimePart = merged.slice(11, 19);
          if (!draft.unit || draft.valueNew == null) {
            return { handler: "odometer", message: "Faltan datos para el resumen.", state };
          }
          const q = buildOdometerConfirmQuestion(draft);
          setOdometerConfirm(state, draft, q);
          return { handler: "odometer", message: q, state };
        }
      }
      draft.fechaTimePart = `${time.length === 5 ? time : time}:00`.slice(0, 8);
      return {
        handler: "odometer",
        message: renderResponsePlan(
          planAskMissingField({
            received: `Perfecto, ya tengo la hora (${time}).`,
            missing: "fecha",
            question: "¿De qué día es la lectura?",
          }),
        ),
        state,
      };
    }

    // Solo fecha — pedir hora; NO pisar con "hoy"
    if (fields.date && !fields.time) {
      draft.fechaDatePart = fields.date;
      draft.fechaLecturaIso = `${fields.date}T00:00:00`;
      draft.fechaDisplay = formatFechaDisplay(draft.fechaLecturaIso);
      const dd = fields.date.slice(8, 10);
      const mm = fields.date.slice(5, 7);
      const yyyy = fields.date.slice(0, 4);
      const finalMsg = `Entendido: ${dd}/${mm}/${yyyy}. ¿A qué hora fue?`;
      setExpectedField(state, {
        text: finalMsg,
        purpose: "ask_time",
        expectedAnswerType: "time",
      });
      return {
        handler: "odometer",
        message: finalMsg,
        state,
      };
    }

    if (fields.date && fields.time) {
      const merged = `${fields.date}T${fields.time.length === 5 ? fields.time + ":00" : fields.time}`;
      draft.fechaLecturaIso = merged;
      draft.fechaDisplay = formatFechaDisplay(merged);
      draft.fechaDatePart = fields.date;
      draft.fechaTimePart = merged.slice(11, 19);
      if (!draft.unit) {
        return { handler: "odometer", message: "Falta la unidad para el odómetro.", state };
      }
      if (draft.valueNew == null) {
        return { handler: "odometer", message: "Falta el valor de la lectura.", state };
      }
      const q = buildOdometerConfirmQuestion(draft);
      setOdometerConfirm(state, draft, q);
      return { handler: "odometer", message: q, state };
    }
  }

  return {
    handler: "odometer",
    message: "Necesito el dato que falta para completar la lectura.",
    state,
  };
}

async function handleAnswerPending(
  decision: TurnDecision,
  state: PilotConversationState,
  deps: ExecuteDeps,
): Promise<ExecuteResult> {
  const pending = state.pendingConfirmation;

  // Cancelación estructurada: puede aplicar a draft activo sin pendingConfirmation.
  const structuredCancel =
    decision.answer === "cancel" ||
    decision.currentTramiteDisposition === "cancel" ||
    decision.speechAct === "cancel";
  if (structuredCancel && !pending && hasCancellableTramite(state)) {
    const r = cancelActiveOrPendingTramite(state);
    return {
      handler: r.cancelled === "none" ? "answer_pending" : r.cancelled,
      message: r.message,
      state,
    };
  }

  if (!pending) {
    return {
      handler: "answer_pending",
      message: "No tengo una confirmación pendiente. ¿En qué te ayudo?",
      state,
    };
  }

  const expected =
    state.lastAgentQuestionMeta?.expectedAnswerType ??
    inferExpectedAnswerTypeFromQuestion(
      state.lastAgentQuestion ?? pending.question,
      pending.action,
    );

  const answeringBinaryCancel =
    expected === "cancel_confirmation" ||
    isBinaryCancelQuestion(pending.question) ||
    isBinaryCancelQuestion(state.lastAgentQuestion);
  const answeringCompound =
    expected === "choice" ||
    isCompoundCancelContinueQuestion(pending.question) ||
    isCompoundCancelContinueQuestion(state.lastAgentQuestion);

  // Protección mínima de escritura: solo bloquea; nunca autoriza ni inicia cancel por texto.
  if (
    mustBlockWriteExecution(deps.originalMessage) &&
    (decision.answer === "confirm" || decision.speechAct === "confirm")
  ) {
    return {
      handler: "answer_pending",
      message:
        "Para confirmar la operación respondé CONFIRMO. Si no querés seguir, decime cancelo.",
      state,
    };
  }

  // Pregunta choice (descartar vs modificar): sí/no solos no alcanzan.
  if (
    answeringCompound &&
    (decision.answer === "confirm" || decision.answer === "reject")
  ) {
    setLastAgentQuestion(state, {
      text: DISCARD_OR_EDIT_QUESTION,
      purpose: "choose_discard_or_edit",
      expectedAnswerType: "choice",
      options: [
        { id: "cancel", meaning: "descartar" },
        { id: "edit", meaning: "modificar" },
      ],
      pendingAction: pending.action,
    });
    return {
      handler: "answer_pending",
      message: DISCARD_OR_EDIT_QUESTION,
      state,
    };
  }

  // Disposition cancel o answer cancel tienen prioridad sobre confirm.
  const wantsCancel =
    decision.currentTramiteDisposition === "cancel" ||
    decision.answer === "cancel" ||
    decision.speechAct === "cancel" ||
    (decision.answer === "reject" && !answeringBinaryCancel);

  if (wantsCancel) {
    const r = cancelActiveOrPendingTramite(state);
    return {
      handler: r.cancelled === "none" ? "answer_pending" : r.cancelled,
      message: r.cancelled === "certificate" ? CANCEL_CERT_REPLY : r.message,
      state,
    };
  }

  if (decision.answer === "reject" && answeringBinaryCancel) {
    let reply = pending.question;
    if (pending.action === "certificate_issue") {
      reply =
        `Puedo solicitar el certificado de cobertura de ${pending.unit.label}.\n` +
        `¿Querés que lo genere?\n\n` +
        `Si está correcto, respondé CONFIRMO.`;
      state.pendingConfirmation = { ...pending, question: reply };
    }
    setLastAgentQuestion(state, {
      text: reply,
      purpose: "confirm_write",
      expectedAnswerType: "confirmation",
      pendingAction: pending.action,
    });
    return { handler: "certificate", message: reply, state };
  }

  // Choice: modificar datos — solo action/speechAct estructurados.
  if (
    expected === "choice" &&
    (decision.action === "correct_fields" || decision.speechAct === "provide_field")
  ) {
    return {
      handler: "answer_pending",
      message: "Ok, ¿qué dato querés corregir?",
      state,
    };
  }

  if (decision.answer === "confirm") {
    // Pregunta binaria de cancelación: sí → cancelar.
    if (answeringBinaryCancel) {
      const r = cancelActiveOrPendingTramite(state);
      return {
        handler: r.cancelled === "none" ? "answer_pending" : r.cancelled,
        message: r.cancelled === "certificate" ? CANCEL_CERT_REPLY : r.message,
        state,
      };
    }

    // En choice, confirm solo no elige descartar/modificar.
    if (expected === "choice") {
      setLastAgentQuestion(state, {
        text: DISCARD_OR_EDIT_QUESTION,
        purpose: "choose_discard_or_edit",
        expectedAnswerType: "choice",
        options: [
          { id: "cancel", meaning: "descartar" },
          { id: "edit", meaning: "modificar" },
        ],
        pendingAction: pending.action,
      });
      return { handler: "answer_pending", message: DISCARD_OR_EDIT_QUESTION, state };
    }

    // Guardrail: escritura solo con decisión confirm + binding + sin veto de seguridad.
    const isWrite =
      pending.action === "odometer_write" ||
      pending.action === "certificate_issue" ||
      pending.action === "maintenance_write" ||
      pending.action === "odoo_ticket_create";
    if (isWrite) {
      const gate = assertStructuredWriteConfirmation({
        decisionAnswer: decision.answer,
        confidence: decision.confidence,
        state,
        originalMessage: deps.originalMessage,
        expectedAction: pending.action,
      });
      if (!gate.ok) {
        console.error(
          JSON.stringify({
            event: "wara_v2_write_confirm_blocked",
            reason: gate.reason,
            pendingAction: pending.action,
            operationId: pending.operationId ?? null,
            questionId: pending.questionId ?? null,
          }),
        );
        if (!state.lastAgentQuestionMeta || state.lastAgentQuestionMeta.expectedAnswerType !== "confirmation") {
          bindPendingConfirmationQuestion(state, pending.question, "confirm_write");
        }
        return {
          handler: "answer_pending",
          message:
            "Para confirmar la operación respondé CONFIRMO. Si no querés seguir, decime cancelo.",
          state,
        };
      }
    }

    if (pending.action === "gps_report") {
      const unit = findUnitInFleetByRef(deps.fleetUnits, pending.unit);
      if (!unit) {
        state.pendingConfirmation = null;
        clearLastAgentQuestion(state);
        return { handler: "gps", message: "No pude encontrar esa unidad. Pedime la lista.", state };
      }
      return {
        handler: "gps",
        message: deps.deliverGpsReport(state, unit),
        state,
      };
    }
    // Ejecución autorizada por decisión estructurada — sin inventar texto del usuario.
    if (pending.action === "odometer_write") {
      const r = await tryResolveOdometerTurn({
        state,
        text: deps.originalMessage,
        messageId: deps.messageId,
        env: deps.env,
        fleetUnits: deps.fleetUnits,
        structuredConfirm: true,
      });
      if (r.kind === "reply") return { handler: "odometer", message: r.message, state: r.state };
    }
    if (pending.action === "certificate_issue") {
      const r = await tryResolveCertificateTurn({
        state,
        text: deps.originalMessage,
        messageId: deps.messageId,
        env: deps.env,
        fleetUnits: deps.fleetUnits,
        structuredConfirm: true,
      });
      if (r.kind === "reply") return { handler: "certificate", message: r.message, state };
    }
    if (pending.action === "maintenance_write") {
      const r = await tryResolveMaintenanceTurn({
        state,
        text: deps.originalMessage,
        messageId: deps.messageId,
        env: deps.env,
        fleetUnits: deps.fleetUnits,
        structuredConfirm: true,
      });
      if (r.kind === "reply") return { handler: "maintenance", message: r.message, state };
    }
    if (pending.action === "odoo_ticket_create") {
      const r = await tryResolveTicketTurn({
        state,
        text: deps.originalMessage,
        messageId: deps.messageId,
        env: deps.env,
        structuredConfirm: true,
      });
      if (r.kind === "reply") return { handler: "ticket", message: r.message, state };
    }
  }

  // No reimprimir el formulario de escritura si la última pregunta era aclaración de cancel.
  if (expected === "cancel_confirmation" || expected === "choice") {
    setLastAgentQuestion(state, {
      text: DISCARD_OR_EDIT_QUESTION,
      purpose: "choose_discard_or_edit",
      expectedAnswerType: "choice",
      options: [
        { id: "cancel", meaning: "descartar" },
        { id: "edit", meaning: "modificar" },
      ],
      pendingAction: pending.action,
    });
    return {
      handler: "answer_pending",
      message: DISCARD_OR_EDIT_QUESTION,
      state,
    };
  }

  if (
    isCompoundCancelContinueQuestion(pending.question) ||
    isCompoundCancelContinueQuestion(state.lastAgentQuestion)
  ) {
    return { handler: "answer_pending", message: COMPOUND_CHOICE_REPLY, state };
  }

  return {
    handler: "answer_pending",
    message: pending.question,
    state,
  };
}

function applyDisposition(state: PilotConversationState, d: TurnDecision): void {
  if (d.currentTramiteDisposition === "suspend") {
    if (state.pendingConfirmation || state.activeTramite !== "none") {
      suspendTramiteForSideQuery(state);
    }
  } else if (d.currentTramiteDisposition === "cancel") {
    clearOperationalTramite(state);
  }
}

async function startMeter(
  decision: TurnDecision,
  state: PilotConversationState,
  deps: ExecuteDeps,
): Promise<ExecuteResult> {
  applyDisposition(state, decision);
  const meterType = decision.intent === "horometer" ? "horometro" : "odometro";
  state.certificateDraft = null;
  state.pendingConfirmation = null;
  state.activeTramite = "odometer_update";
  const draft = emptyOdoDraft(meterType);
  draft.step = state.selectedUnit ? "await_value" : "await_unit";
  if (state.selectedUnit) {
    draft.unit = state.selectedUnit;
    const fu = findUnitInFleetByRef(deps.fleetUnits, state.selectedUnit);
    if (fu) {
      draft.valuePrevious = meterType === "horometro" ? (fu.horometro ?? null) : (fu.odometro ?? null);
    }
  }
  // Si el start ya trae patente/unidad, adjuntarla.
  if (draft.step === "await_unit") {
    const fromEntity = resolveUnitFromDecisionOrText(decision, deps, {
      allowMessageAsUnitField: true,
    });
    if (fromEntity) bindUnitToOdometerDraft(draft, state, fromEntity);
  }
  if (draft.step === "await_unit") {
    state.pendingEntityResolution = createPendingEntityResolution({
      parentIntent: meterType === "horometro" ? "horometer" : "odometer",
      returnToStep: "odometer.await_unit",
      sourceMessageId: deps.messageId,
    });
  } else {
    state.pendingEntityResolution = null;
  }
  state.odometerDraft = draft;
  if (decision.fields?.numericValue != null && draft.step === "await_value") {
    return handleProvideOdometerFields(
      { ...decision, action: "provide_fields", fields: decision.fields },
      state,
      deps,
    )!;
  }
  const label = meterType === "horometro" ? "horómetro" : "odómetro";
  const unitHint = state.selectedUnit?.label ? ` de ${state.selectedUnit.label}` : "";
  // No inventar "trámite anterior" si no había nada activo que suspender.
  const hadPrior =
    decision.action === "suspend_and_start" ||
    (decision.action === "switch_intent" && decision.currentTramiteDisposition === "suspend");
  const prefix = hadPrior
    ? `De acuerdo, dejo pendiente el trámite anterior y seguimos con el ${label}${unitHint}. `
    : decision.action === "switch_intent"
      ? `De acuerdo, seguimos con el ${label}${unitHint}. `
      : "";
  const askValue = `Pasame el valor del ${label}${meterType === "horometro" ? " (hs)" : " (km)"}.`;
  const askUnit = `Decime la patente para el ${label}.`;
  const message = prefix + (draft.step === "await_unit" ? askUnit : askValue);
  if (draft.step === "await_unit") {
    setExpectedField(state, {
      text: askUnit,
      purpose: "ask_unit",
      expectedAnswerType: "unit",
    });
  } else {
    setExpectedField(state, {
      text: askValue,
      purpose: "ask_odometer_value",
      expectedAnswerType: "numeric_value",
    });
  }
  return {
    handler: "odometer",
    message,
    state,
  };
}

async function startCertificate(
  decision: TurnDecision,
  state: PilotConversationState,
  deps: ExecuteDeps,
): Promise<ExecuteResult> {
  applyDisposition(state, decision);
  // Arranque directo sin tryResolveCertificateTurn(texto usuario): evita looksLike* residual.
  state.pendingConfirmation = null;
  state.odometerDraft = null;
  state.activeTramite = "certificate_issue";
  const fromEntity = resolveUnitFromDecisionOrText(decision, deps);
  if (fromEntity) {
    const cont = continueAfterUnitResolved(state, fromEntity, { parentIntent: "certificate" });
    const prefix =
      decision.action === "suspend_and_start" || decision.action === "switch_intent"
        ? "De acuerdo, dejo pendiente el trámite anterior. "
        : "";
    return { handler: cont.handler, message: prefix + cont.message, state };
  }
  const unit = state.selectedUnit;
  if (!unit) {
    state.certificateDraft = {
      unit: null,
      step: "await_unit",
    };
    state.pendingEntityResolution = createPendingEntityResolution({
      parentIntent: "certificate",
      returnToStep: "certificate.await_unit",
      sourceMessageId: deps.messageId,
    });
    return {
      handler: "certificate",
      message: "¿De qué unidad querés el certificado de cobertura?",
      state,
    };
  }
  state.pendingEntityResolution = null;
  state.certificateDraft = {
    unit,
    step: "await_confirm",
  };
  const q =
    `Puedo solicitar el certificado de cobertura de ${unit.label}.\n` +
    `¿Querés que lo genere?\n\n` +
    `Si está correcto, respondé CONFIRMO.`;
  state.pendingConfirmation = {
    action: "certificate_issue",
    unit,
    askedAt: new Date().toISOString(),
    question: q,
  };
  state.lastAgentQuestion = q;
  const prefix =
    decision.action === "suspend_and_start" || decision.action === "switch_intent"
      ? "De acuerdo, dejo pendiente el trámite anterior. "
      : "";
  return { handler: "certificate", message: prefix + q, state };
}


function isContextualEntity(decision: TurnDecision): boolean {
  return (
    decision.entity?.type === "contextual" ||
    decision.reasoningCode === "CONTEXTUAL_REFERENCE" ||
    Boolean(decision.entity?.reference)
  );
}

function handleUnitSearch(decision: TurnDecision, state: PilotConversationState, deps: ExecuteDeps): ExecuteResult {
  ensurePendingForAwaitingUnit(state, deps.messageId);
  const parent = resolveParentIntentForUnitSelection(state);
  const entity = decision.entity;

  // Corrección / undo contextual — solo entity.reference estructurada.
  if (entity?.reference === "previous_selected_unit") {
    const resolved = resolveContextualUnitReference(state, deps.fleetUnits, {
      reference: "previous_selected_unit",
    });
    if (resolved.kind === "restore") {
      return { handler: "unit_context_restore", message: resolved.message, state };
    }
    if (resolved.kind === "clarify") {
      return { handler: "unit_context_clarify", message: resolved.message, state };
    }
    if (resolved.kind === "unit") {
      const cont = continueAfterUnitResolved(state, resolved.unit, {
        parentIntent: parent ?? (decision.intent === "gps" ? "gps" : null),
      });
      return { handler: cont.handler, message: cont.message, state };
    }
  }

  // Confirmar proposedUnit — solo answer=confirm.
  if (state.proposedUnit && decision.answer === "confirm") {
    const confirmed = confirmProposedUnit(state, deps.fleetUnits);
    if (confirmed.kind === "unit") {
      const cont = continueAfterUnitResolved(state, confirmed.unit, { parentIntent: parent });
      return { handler: cont.handler, message: cont.message, state };
    }
    if (confirmed.kind === "restore") {
      return { handler: "unit_context_restore", message: confirmed.message, state };
    }
  }

  const reference =
    entity?.reference ??
    (entity?.type === "contextual" ? "selected_unit" : null) ??
    (decision.reasoningCode === "CONTEXTUAL_REFERENCE" ? "selected_unit" : null);

  if (isContextualEntity(decision) && entity?.type !== "index" && entity?.type !== "plate") {
    const resolved = resolveContextualUnitReference(state, deps.fleetUnits, {
      reference: reference ?? "selected_unit",
    });
    if (resolved.kind === "restore") {
      if (decision.intent === "gps") {
        const fu = findUnitInFleetByRef(deps.fleetUnits, resolved.unit);
        if (fu) {
          const cont = continueAfterUnitResolved(state, fu, { parentIntent: "gps" });
          return { handler: cont.handler, message: cont.message, state };
        }
      }
      return { handler: "unit_context_restore", message: resolved.message, state };
    }
    if (resolved.kind === "clarify") {
      return { handler: "unit_context_clarify", message: resolved.message, state };
    }
    if (resolved.kind === "unit") {
      const intentParent = parent ?? (decision.intent === "gps" ? "gps" : null);
      if (!intentParent && state.selectedUnit && resolved.unit.movil_id === state.selectedUnit.movil_id) {
        commitSelectedUnit(state, resolved.unit, "contextual_reference");
        if (decision.intent === "gps") {
          const cont = continueAfterUnitResolved(state, resolved.unit, { parentIntent: "gps" });
          return { handler: cont.handler, message: cont.message, state };
        }
        return {
          handler: "unit_context",
          message: `Seguimos con ${state.selectedUnit.label}. ¿Qué querés consultar o gestionar?`,
          state,
        };
      }
      const applied = applyResolvedUnit(state, resolved.unit, "contextual_reference", {
        parentIntent: intentParent,
        forceCommit: Boolean(intentParent),
      });
      if (applied.kind === "propose") {
        return {
          handler: "unit_propose",
          message: proposeUnit(state, applied.unit, applied.insteadOf),
          state,
        };
      }
      const cont = continueAfterUnitResolved(state, resolved.unit, { parentIntent: intentParent });
      return { handler: cont.handler, message: cont.message, state };
    }
  }

  if (!entity) {
    if (state.selectedUnit && decision.intent === "gps") {
      const fu = findUnitInFleetByRef(deps.fleetUnits, state.selectedUnit);
      if (fu) {
        const cont = continueAfterUnitResolved(state, fu, { parentIntent: "gps" });
        return { handler: cont.handler, message: cont.message, state };
      }
    }
    return {
      handler: "unit_search",
      message: "¿Qué patente o unidad buscás?",
      state,
    };
  }

  if (entity.type === "index" && entity.value) {
    const idx = Number(entity.value);
    const listing = state.lastListing;
    if (listing && idx > 0) {
      const unit = listing.units[idx - 1];
      if (unit) {
        const applied = applyResolvedUnit(state, unit, "list_index", {
          parentIntent: parent,
          forceCommit: Boolean(parent),
        });
        if (applied.kind === "propose") {
          return {
            handler: "unit_propose",
            message: proposeUnit(state, applied.unit, applied.insteadOf),
            state,
          };
        }
        const cont = continueAfterUnitResolved(state, unit, { parentIntent: parent });
        return { handler: cont.handler, message: cont.message, state };
      }
    }
  }

  const matchMode =
    entity.matchMode === "prefix" ||
    entity.matchMode === "suffix" ||
    entity.matchMode === "contains" ||
    entity.matchMode === "exact"
      ? entity.matchMode
      : "exact";
  const query = (entity.value ?? "").trim().toUpperCase();
  if (!query) {
    // Evitar búsqueda vacía → primer resultado.
    const resolved = resolveContextualUnitReference(state, deps.fleetUnits, {
      reference: reference ?? "selected_unit",
    });
    if (resolved.kind === "unit") {
      const cont = continueAfterUnitResolved(state, resolved.unit, {
        parentIntent: parent ?? (decision.intent === "gps" ? "gps" : null),
      });
      return { handler: cont.handler, message: cont.message, state };
    }
    if (resolved.kind === "restore") {
      return { handler: "unit_context_restore", message: resolved.message, state };
    }
    if (resolved.kind === "clarify") {
      return { handler: "unit_context_clarify", message: resolved.message, state };
    }
    return {
      handler: "unit_search",
      message: "¿Qué patente o unidad buscás?",
      state,
    };
  }
  touchPendingSearch(state, { searchMode: matchMode, query });

  const interpretation: UnitSearchInterpretation = {
    intent: decision.intent === "gps" ? "unit_status" : "find_unit",
    entity: entity.type === "unit_name" ? "unit_name" : "license_plate",
    matchMode,
    query,
    confidence: "high",
    source: "rules",
  };

  let result = executeUnitSearch(interpretation, deps.fleetUnits, {
    lastListing: state.lastListing,
    selectedUnit: state.selectedUnit,
    lastSelectedIndex: state.lastListingPickIndex ?? null,
  });
  // Entity type mal etiquetado (plate vs unit_name): probar el otro operador sobre el mismo query.
  if (result.kind === "none") {
    const altEntity = interpretation.entity === "unit_name" ? "license_plate" : "unit_name";
    result = executeUnitSearch(
      { ...interpretation, entity: altEntity },
      deps.fleetUnits,
      {
        lastListing: state.lastListing,
        selectedUnit: state.selectedUnit,
        lastSelectedIndex: state.lastListingPickIndex ?? null,
      },
    );
  }

  if (result.kind === "one") {
    const applied = applyResolvedUnit(state, result.unit, "explicit_plate", {
      parentIntent: parent,
      forceCommit: Boolean(parent) || matchMode === "exact",
    });
    if (applied.kind === "propose") {
      return {
        handler: "unit_propose",
        message: proposeUnit(state, applied.unit, applied.insteadOf),
        state,
      };
    }
    const cont = continueAfterUnitResolved(state, result.unit, { parentIntent: parent });
    return { handler: cont.handler, message: cont.message, state };
  }
  if (result.kind === "many") {
    const listing = buildPaginatedListing({
      units: result.units,
      page: 1,
      kind: "search_results",
      searchLabel: interpretation.query,
    });
    const header = `Encontré ${result.units.length} unidades para «${interpretation.query}»${state.companyName ? ` en ${state.companyName}` : ""}:`;
    const msg = `${header}\n\n${listing.units
      .slice(0, listing.pageSize)
      .map((u, i) => `${i + 1}. ${formatUnitLabel(u)}`)
      .join("\n")}\n\nDecime el número o la patente/nombre de la unidad${parent ? " para continuar el trámite" : ""}.`;
    // Listado NO cambia selectedUnit.
    state.lastListing = listing;
    state.lastAgentQuestion = msg;
    if (!state.pendingEntityResolution && !parent) {
      deps.showListing(state, listing, msg);
    } else {
      if (parent === "certificate") state.activeTramite = "certificate_issue";
      else if (parent === "odometer" || parent === "horometer") state.activeTramite = "odometer_update";
      else if (parent === "maintenance") state.activeTramite = "maintenance_request";
      else if (parent === "ticket") state.activeTramite = "odoo_ticket";
      else if (parent === "gps") state.activeTramite = "search_unit";
    }
    return { handler: "unit_search", message: msg, state };
  }

  return {
    handler: "unit_search",
    message: `No encontré unidades para «${interpretation.query}». Probá otro prefijo o pedime la lista.`,
    state,
  };
}

export async function executeTurnDecision(
  decision: TurnDecision,
  state: PilotConversationState,
  deps: ExecuteDeps,
): Promise<ExecuteResult> {
  if (decision.action === "clarify") {
    const q = decision.ambiguity!.question;
    setLastAgentQuestion(state, {
      text: q,
      purpose: "clarify",
      expectedAnswerType: inferExpectedAnswerTypeFromQuestion(q, state.pendingConfirmation?.action),
      options:
        /\bdescartar\b/i.test(q) && /\bmodificar\b/i.test(q)
          ? [
              { id: "cancel", meaning: "descartar" },
              { id: "edit", meaning: "modificar" },
            ]
          : undefined,
      pendingAction: state.pendingConfirmation?.action ?? null,
    });
    return {
      handler: "clarify",
      message: q,
      state,
    };
  }

  // Expectativa dominante de unidad: no dejar que query_context / general / cortesía la secuestren.
  const awaitingUnitEarly =
    Boolean(state.pendingEntityResolution) || state.certificateDraft?.step === "await_unit";
  if (awaitingUnitEarly) {
    const isCancel =
      decision.answer === "cancel" ||
      decision.speechAct === "cancel" ||
      decision.disposition === "cancel_active" ||
      (decision.currentTramiteDisposition === "cancel" &&
        (decision.speechAct === "farewell" || decision.action === "answer_pending"));
    const isUnitPath =
      decision.action === "select_entity" ||
      decision.intent === "unit_search" ||
      decision.intent === "unit_list" ||
      decision.action === "provide_fields" ||
      decision.action === "correct_fields" ||
      Boolean(decision.entity?.value?.trim());
    if (!isCancel && !isUnitPath && decision.action !== "answer_pending") {
      const parent = resolveParentIntentForUnitSelection(state);
      const unit = resolveUnitFromDecisionOrText(decision, deps, {
        allowMessageAsUnitField: true,
      });
      if (unit) {
        const cont = continueAfterUnitResolved(state, unit, { parentIntent: parent });
        return { handler: cont.handler, message: cont.message, state };
      }
      const ask = resolveAwaitUnitAsk(state, parent);
      return { handler: "await_unit", message: ask, state };
    }
  }

  if (
    decision.intent !== "unit_list" &&
    decision.intent !== "unit_search" &&
    (decision.action === "query_context" ||
      decision.companyAction === "query_active" ||
      (decision.intent === "query_active_company" &&
        (decision.companyAction === "query_active" ||
          decision.speechAct === "query_context" ||
          decision.companyReference === "active")))
  ) {
    return {
      handler: "query_active_company",
      message: replyActiveCompany(state),
      state,
    };
  }

  // Despedida / cierre con disposition cancel: limpiar escritura pendiente sin ejecutar.
  if (
    decision.action === "general" &&
    decision.currentTramiteDisposition === "cancel" &&
    state.pendingConfirmation
  ) {
    const pendingAction = state.pendingConfirmation.action;
    const r = cancelActiveOrPendingTramite(state);
    return {
      handler: "farewell",
      message:
        pendingAction === "odoo_ticket_create"
          ? "De acuerdo. No generé el ticket. Cuando quieras, seguimos."
          : r.message,
      state,
    };
  }

  if (decision.action === "answer_domain_question" || decision.intent === "domain_knowledge") {
    // Consulta lateral: no mutar draft / pending / operationId.
    const snapshot = {
      pending: state.pendingConfirmation,
      draft: state.odometerDraft,
      cert: state.certificateDraft,
      maint: state.maintenanceDraft,
      ticket: state.ticketDraft,
      unit: state.selectedUnit,
      active: state.activeTramite,
      step: state.step,
      opId: state.pendingConfirmation?.operationId ?? null,
    };
    const ans = answerDomainQuestion(state, deps.originalMessage, decision.domainQuestion);
    // Garantizar continuidad (cero efectos).
    state.pendingConfirmation = snapshot.pending;
    state.odometerDraft = snapshot.draft;
    state.certificateDraft = snapshot.cert;
    state.maintenanceDraft = snapshot.maint;
    state.ticketDraft = snapshot.ticket;
    state.selectedUnit = snapshot.unit;
    state.activeTramite = snapshot.active;
    state.step = snapshot.step;
    if (snapshot.pending && snapshot.opId) {
      state.pendingConfirmation = { ...snapshot.pending, operationId: snapshot.opId };
    }
    return { handler: ans.handler, message: ans.message, state };
  }

  if (decision.action === "resume") {
    resumeSuspendedTramite(state);
    const msg =
      state.pendingConfirmation?.question ??
      (state.selectedUnit
        ? `Retomamos con ${state.selectedUnit.label}. ¿Seguimos?`
        : "Retomamos el trámite anterior. ¿Qué necesitás?");
    return { handler: "resume", message: msg, state };
  }

  if (decision.action === "answer_pending") {
    return handleAnswerPending(decision, state, deps);
  }

  if (decision.action === "provide_fields" || decision.action === "correct_fields") {
    // GPS pendiente heredado: no dejar que un provide_fields genérico secuestre el "sí"/reporte.
    if (state.pendingConfirmation?.action === "gps_report") {
      const msg = deps.originalMessage;
      if (decision.answer === "confirm" || decision.intent === "gps") {
        const unit = findUnitInFleetByRef(deps.fleetUnits, state.pendingConfirmation.unit);
        if (unit) {
          return {
            handler: "gps",
            message: deps.deliverGpsReport(state, unit),
            state,
          };
        }
      }
    }
    if (decision.intent === "odometer" || decision.intent === "horometer" || state.odometerDraft) {
      const r = handleProvideOdometerFields(decision, state, deps);
      if (r) return r;
    }
    // Captura de unidad abierta (certificado / pendingEntityResolution): expected-field unit.
    const awaitingUnitCapture =
      Boolean(state.pendingEntityResolution) ||
      state.certificateDraft?.step === "await_unit" ||
      state.maintenanceDraft?.step === "await_unit";
    if (awaitingUnitCapture) {
      const parent = resolveParentIntentForUnitSelection(state);
      const unit = resolveUnitFromDecisionOrText(decision, deps, {
        allowMessageAsUnitField: true,
      });
      if (unit) {
        const cont = continueAfterUnitResolved(state, unit, { parentIntent: parent });
        return { handler: cont.handler, message: cont.message, state };
      }
      // Si hay entity tipada, ir por búsqueda estructurada (select_entity).
      if (decision.entity?.value) {
        return handleUnitSearch(
          { ...decision, action: "select_entity" },
          state,
          deps,
        );
      }
      const ask = resolveAwaitUnitAsk(state, parent);
      return { handler: "await_unit", message: ask, state };
    }
    if (decision.intent === "maintenance" && decision.fields?.detail) {
      const r = await tryResolveMaintenanceTurn({
        state,
        text: decision.fields.detail,
        messageId: deps.messageId,
        env: deps.env,
        fleetUnits: deps.fleetUnits,
      });
      if (r.kind === "reply") return { handler: "maintenance", message: r.message, state };
    }
    console.error(
      JSON.stringify({
        event: "wara_v2_orchestration_error",
        reason: "provide_fields_without_target",
        intent: decision.intent,
        activeTramite: state.activeTramite,
        pending: state.pendingConfirmation?.action ?? null,
      }),
    );
    return {
      handler: "provide_fields",
      message: renderResponsePlan(
        planOrchestrationClarify(
          state.activeTramite !== "none"
            ? `Hay un trámite activo (${state.activeTramite}). Decime el dato que falta o qué querés hacer.`
            : "Decime qué trámite querés o qué dato completar.",
        ),
      ),
      state,
    };
  }

  if (decision.action === "lateral_query" && decision.intent === "gps") {
    const activeUnitRef =
      state.odometerDraft?.unit ??
      state.certificateDraft?.unit ??
      state.pendingConfirmation?.unit ??
      state.selectedUnit;
    suspendTramiteForSideQuery(state);
    const side = await deps.handleGpsSideQuery({
      state,
      // Texto solo como fallback residual si decision.entity falta (documentado).
      text: deps.originalMessage,
      fleetUnits: deps.fleetUnits,
      activeUnitRef,
      entity: decision.entity ?? null,
    });
    return { handler: "gps_lateral", message: side.message, state: side.state };
  }

  if (decision.action === "select_entity" || decision.intent === "unit_search") {
    return handleUnitSearch(decision, state, deps);
  }

  if (decision.intent === "unit_list") {
    // «estado de la unidad» con selectedUnit → GPS de la activa, no listar 408.
    if (
      state.selectedUnit &&
      (decision.reasoningCode === "CONTEXTUAL_REFERENCE" ||
        decision.entity?.type === "contextual" ||
        Boolean(decision.entity?.reference))
    ) {
      const fu = findUnitInFleetByRef(deps.fleetUnits, state.selectedUnit);
      if (fu) {
        const cont = continueAfterUnitResolved(state, fu, { parentIntent: "gps" });
        return { handler: cont.handler, message: cont.message, state };
      }
    }
    ensurePendingForAwaitingUnit(state, deps.messageId);
    const listing = buildPaginatedListing({ units: deps.fleetUnits, page: 1, kind: "fleet_page" });
    const parent = resolveParentIntentForUnitSelection(state);
    const message = formatPaginatedFleetMessage(listing, state.companyName);
    state.lastListing = listing;
    // Expectativa dominante = captura de unidad; NUNCA el cuerpo del listado (evita re-emitir 408 filas).
    state.lastAgentQuestion = unitAwaitAskMessage(parent);
    touchPendingSearch(state, { searchMode: "list" });
    if (!parent) {
      deps.showListing(state, listing, message);
    } else if (parent === "certificate") {
      state.activeTramite = "certificate_issue";
    } else if (parent === "odometer" || parent === "horometer") {
      state.activeTramite = "odometer_update";
    } else if (parent === "maintenance") {
      state.activeTramite = "maintenance_request";
    } else if (parent === "ticket") {
      state.activeTramite = "odoo_ticket";
    } else if (parent === "gps") {
      state.activeTramite = "search_unit";
    }
    return { handler: "unit_list", message, state };
  }

  // Expectativa dominante de unidad: no caer al menú general (cortesía / general residual).
  // unit_list ya se atendió arriba (lista válida mientras se pide patente).
  if (state.pendingEntityResolution || state.certificateDraft?.step === "await_unit") {
    const parent = resolveParentIntentForUnitSelection(state);
    const unit = resolveUnitFromDecisionOrText(decision, deps, {
      allowMessageAsUnitField: true,
    });
    if (unit) {
      const cont = continueAfterUnitResolved(state, unit, { parentIntent: parent });
      return { handler: cont.handler, message: cont.message, state };
    }
    if (decision.entity?.value) {
      return handleUnitSearch({ ...decision, action: "select_entity" }, state, deps);
    }
    const ask = resolveAwaitUnitAsk(state, parent);
    return { handler: "await_unit", message: ask, state };
  }

  if (
    decision.action === "start_intent" ||
    decision.action === "switch_intent" ||
    decision.action === "suspend_and_start"
  ) {
    if (decision.intent === "certificate") return startCertificate(decision, state, deps);
    if (decision.intent === "odometer" || decision.intent === "horometer") {
      return startMeter(decision, state, deps);
    }
    if (decision.intent === "gps") {
      applyDisposition(state, decision);
      state.pendingEntityResolution = createPendingEntityResolution({
        parentIntent: "gps",
        returnToStep: "gps.await_unit",
        sourceMessageId: deps.messageId,
      });
      if (state.selectedUnit) {
        const unit = findUnitInFleetByRef(deps.fleetUnits, state.selectedUnit);
        if (unit) {
          const cont = continueAfterUnitResolved(state, unit, { parentIntent: "gps" });
          return { handler: cont.handler, message: cont.message, state };
        }
      }
      const fromEntity = resolveUnitFromDecisionOrText(decision, deps);
      if (fromEntity) {
        const cont = continueAfterUnitResolved(state, fromEntity, { parentIntent: "gps" });
        return { handler: cont.handler, message: cont.message, state };
      }
      return { handler: "gps", message: unitAwaitAskMessage("gps"), state };
    }
    if (decision.intent === "maintenance") {
      applyDisposition(state, decision);
      state.pendingEntityResolution = createPendingEntityResolution({
        parentIntent: "maintenance",
        returnToStep: "maintenance.await_unit",
        sourceMessageId: deps.messageId,
      });
      const r = await tryResolveMaintenanceTurn({
        state,
        text: "solicitar mantenimiento",
        messageId: deps.messageId,
        env: deps.env,
        fleetUnits: deps.fleetUnits,
      });
      if (r.kind === "reply") return { handler: "maintenance", message: r.message, state };
    }
    if (decision.intent === "ticket" || decision.intent === "human_handoff") {
      applyDisposition(state, decision);
      if (!state.selectedUnit) {
        state.pendingEntityResolution = createPendingEntityResolution({
          parentIntent: "ticket",
          returnToStep: "ticket.await_unit",
          sourceMessageId: deps.messageId,
        });
      }
      const r = await tryResolveTicketTurn({
        state,
        text: decision.fields?.detail ?? "quiero hablar con un asesor",
        messageId: deps.messageId,
        env: deps.env,
      });
      if (r.kind === "reply") return { handler: "ticket", message: r.message, state };
    }
  }

  return {
    handler: "general",
    message: "¿En qué te puedo ayudar?",
    state,
  };
}
