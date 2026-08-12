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
  toFleetUnitRef,
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
import { cancelActiveOrPendingTramite } from "./cancel-active-tramite.js";
import { FECHA_LECTURA_QUESTION } from "./natural-datetime.js";
import {
  formatAnomalyQuestion,
  isAnomalousReading,
  looksLikeAnomalyAck,
  looksLikeAnomalyReject,
} from "./reading-anomaly.js";
import type { ClearableField } from "./field-correction.js";

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
  state.pendingConfirmation = {
    action: "odometer_write",
    unit: draft.unit!,
    askedAt: new Date().toISOString(),
    question,
    operationId: state.pendingConfirmation?.operationId,
  };
  state.lastAgentQuestion = question;
}

function handleCorrectOdometerFields(
  decision: TurnDecision,
  state: PilotConversationState,
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
      const dia = formatFechaDiaLargo(draft.fechaLecturaIso, TZ);
      return {
        handler: "odometer",
        message: `Perfecto, ${dia}. ¿A qué hora?`,
        state,
      };
    } else if (time && !date) {
      draft.fechaTimePart = `${time.length === 5 ? time : time}:00`.slice(0, 8);
      return {
        handler: "odometer",
        message: `Perfecto, ${time}. ¿De qué día es la lectura?`,
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
  deps?: ExecuteDeps,
): ExecuteResult | null {
  const draft = state.odometerDraft;
  if (!draft || draft.step === "idle") return null;

  if (decision.action === "correct_fields") {
    return handleCorrectOdometerFields(decision, state);
  }

  const fields = decision.fields ?? {};
  const meterType = draft.meterType ?? (decision.intent === "horometer" ? "horometro" : "odometro");
  draft.meterType = meterType;

  // Confirmación reforzada de valor anómalo.
  if (draft.step === "await_anomaly_confirm") {
    const text = deps?.originalMessage ?? "";
    if (looksLikeAnomalyAck(text) || decision.answer === "confirm") {
      draft.valueNew = draft.anomalyCandidate ?? draft.valueNew;
      draft.anomalyCandidate = null;
      draft.step = "await_fecha";
      return { handler: "odometer", message: FECHA_LECTURA_QUESTION, state };
    }
    if (looksLikeAnomalyReject(text) || decision.answer === "reject" || decision.answer === "cancel") {
      draft.anomalyCandidate = null;
      draft.valueNew = null;
      draft.step = "await_value";
      return {
        handler: "odometer",
        message: `Ok, descarté ese valor. Pasame el ${meterType === "horometro" ? "horómetro (hs)" : "odómetro (km)"} correcto.`,
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
        message: `Perfecto, ${time}. ¿De qué día es la lectura?`,
        state,
      };
    }

    // Solo fecha — pedir hora; NO pisar con "hoy"
    if (fields.date && !fields.time) {
      draft.fechaDatePart = fields.date;
      draft.fechaLecturaIso = `${fields.date}T00:00:00`;
      draft.fechaDisplay = formatFechaDisplay(draft.fechaLecturaIso);
      const dia = formatFechaDiaLargo(draft.fechaLecturaIso, TZ);
      return {
        handler: "odometer",
        message: `Perfecto, ${dia}. ¿A qué hora?`,
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
  if (!pending) {
    return {
      handler: "answer_pending",
      message: "No tengo una confirmación pendiente. ¿En qué te ayudo?",
      state,
    };
  }

  const answeringBinaryCancel =
    isBinaryCancelQuestion(pending.question) || isBinaryCancelQuestion(state.lastAgentQuestion);
  const answeringCompound =
    isCompoundCancelContinueQuestion(pending.question) ||
    isCompoundCancelContinueQuestion(state.lastAgentQuestion);

  // Pregunta compuesta: sí/no/reject/confirm no pueden ejecutar ni cancelar.
  if (
    answeringCompound &&
    (decision.answer === "confirm" || decision.answer === "reject")
  ) {
    return {
      handler: "answer_pending",
      message: COMPOUND_CHOICE_REPLY,
      state,
    };
  }

  // Disposition cancel o answer cancel tienen prioridad sobre confirm.
  // "reject" solo cancela si NO estamos ante una pregunta binaria de cancelación
  // (en ese caso "no" = conservar el trámite).
  const wantsCancel =
    decision.currentTramiteDisposition === "cancel" ||
    decision.answer === "cancel" ||
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
    state.lastAgentQuestion = reply;
    return { handler: "certificate", message: reply, state };
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
    if (pending.action === "gps_report") {
      const unit = findUnitInFleetByRef(deps.fleetUnits, pending.unit);
      if (!unit) {
        state.pendingConfirmation = null;
        return { handler: "gps", message: "No pude encontrar esa unidad. Pedime la lista.", state };
      }
      return {
        handler: "gps",
        message: deps.deliverGpsReport(state, unit),
        state,
      };
    }
    // Reutilizar paths de escritura con CONFIRMO sintético (ya autorizado por decisión).
    if (pending.action === "odometer_write") {
      const r = await tryResolveOdometerTurn({
        state,
        text: "CONFIRMO",
        messageId: deps.messageId,
        env: deps.env,
        fleetUnits: deps.fleetUnits,
      });
      if (r.kind === "reply") return { handler: "odometer", message: r.message, state: r.state };
    }
    if (pending.action === "certificate_issue") {
      const r = await tryResolveCertificateTurn({
        state,
        text: "CONFIRMO",
        messageId: deps.messageId,
        env: deps.env,
        fleetUnits: deps.fleetUnits,
      });
      if (r.kind === "reply") return { handler: "certificate", message: r.message, state };
    }
    if (pending.action === "maintenance_write") {
      const r = await tryResolveMaintenanceTurn({
        state,
        text: "CONFIRMO",
        messageId: deps.messageId,
        env: deps.env,
        fleetUnits: deps.fleetUnits,
      });
      if (r.kind === "reply") return { handler: "maintenance", message: r.message, state };
    }
    if (pending.action === "odoo_ticket_create") {
      const r = await tryResolveTicketTurn({
        state,
        text: "CONFIRMO",
        messageId: deps.messageId,
        env: deps.env,
      });
      if (r.kind === "reply") return { handler: "ticket", message: r.message, state };
    }
  }

  // answer null con pregunta binaria de cancelación + texto no clasificado: no ejecutar.
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
  const prefix =
    decision.action === "suspend_and_start" || decision.action === "switch_intent"
      ? `De acuerdo, dejo pendiente el trámite anterior y seguimos con el ${label}${unitHint}. `
      : "";
  return {
    handler: "odometer",
    message:
      prefix +
      (draft.step === "await_unit"
        ? `Decime la patente para el ${label}.`
        : `Pasame el valor del ${label}${meterType === "horometro" ? " (hs)" : " (km)"}.`),
    state,
  };
}

async function startCertificate(
  decision: TurnDecision,
  state: PilotConversationState,
  _deps: ExecuteDeps,
): Promise<ExecuteResult> {
  applyDisposition(state, decision);
  // Arranque directo sin tryResolveCertificateTurn(texto usuario): evita looksLike* residual.
  state.pendingConfirmation = null;
  state.odometerDraft = null;
  state.activeTramite = "certificate_issue";
  const unit = state.selectedUnit;
  if (!unit) {
    state.certificateDraft = {
      unit: null,
      step: "await_unit",
    };
    return {
      handler: "certificate",
      message: "¿De qué unidad querés el certificado de cobertura?",
      state,
    };
  }
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

function handleUnitSearch(decision: TurnDecision, state: PilotConversationState, deps: ExecuteDeps): ExecuteResult {
  const entity = decision.entity;
  if (!entity) {
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
        const msg = deps.askGpsConfirmation(state, unit);
        return { handler: "unit_search", message: msg, state };
      }
    }
  }

  const interpretation: UnitSearchInterpretation = {
    intent: decision.intent === "gps" ? "unit_status" : "find_unit",
    entity: entity.type === "unit_name" ? "unit_name" : "license_plate",
    matchMode:
      entity.matchMode === "prefix" ||
      entity.matchMode === "suffix" ||
      entity.matchMode === "contains" ||
      entity.matchMode === "exact"
        ? entity.matchMode
        : "exact",
    query: (entity.value ?? "").trim().toUpperCase(),
    confidence: "high",
    source: "rules",
  };

  const result = executeUnitSearch(interpretation, deps.fleetUnits, {
    lastListing: state.lastListing,
    selectedUnit: state.selectedUnit,
    lastSelectedIndex: state.lastListingPickIndex ?? null,
  });

  if (result.kind === "one") {
    const msg = deps.askGpsConfirmation(state, result.unit);
    return { handler: "unit_search", message: msg, state };
  }
  if (result.kind === "many") {
    const listing = buildPaginatedListing({
      units: result.units,
      page: 1,
      kind: "search_results",
      searchLabel: interpretation.query,
    });
    const header = `Encontré ${result.units.length} unidades para «${interpretation.query}»${state.companyName ? ` en ${state.companyName}` : ""}:`;
    const body = formatPaginatedFleetMessage(listing, state.companyName).replace(/^[\s\S]*?\n\n/, "");
    const message = `${header}\n\n${listing.units
      .slice(0, listing.pageSize)
      .map((u, i) => `${i + 1}. ${formatUnitLabel(u)}`)
      .join("\n")}\n\nDecime el número o la patente/nombre de la unidad que querés consultar.`;
    deps.showListing(state, listing, message);
    void body;
    return { handler: "unit_search", message, state };
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
    return {
      handler: "clarify",
      message: decision.ambiguity!.question,
      state,
    };
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
    if (decision.intent === "odometer" || decision.intent === "horometer" || state.odometerDraft) {
      const r = handleProvideOdometerFields(decision, state, deps);
      if (r) return r;
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
    return {
      handler: "provide_fields",
      message: "Recibí el dato. ¿Me confirmás o completás lo que falta?",
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
    const listing = buildPaginatedListing({ units: deps.fleetUnits, page: 1, kind: "fleet_page" });
    const message = formatPaginatedFleetMessage(listing, state.companyName);
    deps.showListing(state, listing, message);
    return { handler: "unit_list", message, state };
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
      if (state.selectedUnit) {
        const unit = findUnitInFleetByRef(deps.fleetUnits, state.selectedUnit);
        if (unit) {
          return { handler: "gps", message: deps.askGpsConfirmation(state, unit), state };
        }
      }
      return { handler: "gps", message: "Decime la patente para el reporte GPS.", state };
    }
    if (decision.intent === "maintenance") {
      applyDisposition(state, decision);
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
    message:
      "Puedo ayudarte con GPS, certificado, odómetro/horómetro, mantenimiento, reclamos o buscar unidades. ¿Qué necesitás?",
    state,
  };
}
