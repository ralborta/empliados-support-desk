/**
 * Flujo determinístico odómetro/horómetro V2 — lab, sin escrituras reales por defecto.
 */
import type { PilotConversationState, PilotSelectedUnit } from "./conversation-state.js";
import type { OdometerDraft, MeterType } from "./odometer-types.js";
import {
  buildOperationRecord,
  createOperationId,
  findCompletedByConfirmMessageId,
  findCompletedByPayloadHash,
  hashOdometerPayload,
} from "./odometer-operation.js";
import {
  detectMeterTypeFromText,
  extractNumericReading,
  formatCurrentReading,
  formatFechaDiaLargo,
  formatFechaDisplay,
  fechaLecturaTieneHora,
  looksLikeCancelOdometer,
  looksLikeClockTimeOnlyMessage,
  looksLikeExplicitConfirm,
  looksLikeExplicitReject,
  looksLikeOdometerIntent,
  looksLikeOdometerSideInfoQuery,
  mergeFechaConHoraSuelt,
  parseFechaLectura,
  validateNoRetroceso,
  validateReading,
} from "./odometer-core.js";
import {
  looksLikeBriefConfirmation,
  looksLikeBriefRejection,
  looksLikeGpsReportRequest,
  looksLikePendingConfirmComprehensionAck,
  looksLikeResumePausedTramite,
} from "./brief-replies.js";
import { registerOdometerHorometro } from "./odometer-wara.js";
import { isPilotDryRun } from "./write-gates.js";
import { syncPilotOperationToPrisma } from "./pilot-operation-sync.js";
import { findUnitInFleetByRef, toFleetUnitRef } from "./unit-fleet.js";
import type { WaraUnidadEstado } from "./wara-types.js";

export type OdometerTurnResult =
  | { kind: "none" }
  | { kind: "reply"; message: string; state: PilotConversationState }
  | { kind: "gps_side_during_odometer"; text: string; state: PilotConversationState };

export type OdometerWriteDeps = {
  registerReading?: (input: {
    sessionToken: string;
    patente: string;
    meterType: MeterType;
    value: number;
    fechaIso: string;
    dryRun: boolean;
  }) => Promise<{ ok: boolean; error?: string; summary?: string; payload?: Record<string, unknown> }>;
};

let testDeps: OdometerWriteDeps | undefined;

export function setOdometerWriteDepsForTests(deps: OdometerWriteDeps | undefined): void {
  testDeps = deps;
}

function emptyDraft(): OdometerDraft {
  return {
    meterType: null,
    unit: null,
    valueNew: null,
    valuePrevious: null,
    fechaLecturaIso: null,
    fechaDisplay: null,
    fechaDatePart: null,
    fechaTimePart: null,
    step: "idle",
  };
}

function finishFechaAndConfirm(
  state: PilotConversationState,
  draft: OdometerDraft,
  fecha: string,
): OdometerTurnResult {
  draft.fechaLecturaIso = fecha;
  draft.fechaDisplay = formatFechaDisplay(fecha);
  draft.fechaDatePart = fecha.slice(0, 10);
  draft.fechaTimePart = fecha.slice(11, 19);
  draft.step = "await_confirm";
  if (!draft.unit || draft.valueNew == null || !draft.meterType) {
    return { kind: "reply", message: "Faltan datos del trámite.", state };
  }
  const q = buildConfirmQuestion(
    draft.unit,
    draft.meterType,
    draft.valueNew,
    draft.fechaDisplay,
    draft.valuePrevious,
  );
  const opId = createOperationId();
  state.pendingConfirmation = {
    action: "odometer_write",
    unit: draft.unit,
    askedAt: new Date().toISOString(),
    question: q,
    operationId: opId,
  };
  return { kind: "reply", message: q, state };
}

function previousReading(unit: WaraUnidadEstado, meterType: MeterType): number | null {
  if (meterType === "horometro") {
    const h = unit.horometro ?? unit.odometro;
    if (typeof h === "number" && Number.isFinite(h)) return h;
  }
  const o = unit.odometro;
  if (typeof o === "number" && Number.isFinite(o)) return o;
  return null;
}

function buildConfirmQuestion(
  unit: PilotSelectedUnit,
  meterType: MeterType,
  value: number,
  fechaDisplay: string,
  valuePrevious: number | null,
): string {
  const label = meterType === "horometro" ? "Horómetro" : "Odómetro";
  const prev =
    valuePrevious != null
      ? `\n• Anterior: ${valuePrevious}${meterType === "horometro" ? " hs" : " km"}`
      : "";
  return (
    `Voy a registrar en WARA:\n` +
    `• ${unit.label}\n` +
    `• ${label}: ${value}${meterType === "horometro" ? " hs" : " km"}${prev}\n` +
    `• Fecha: ${fechaDisplay}\n` +
    `Si está correcto, respondé CONFIRMO.`
  );
}

async function executeWrite(
  state: PilotConversationState,
  draft: OdometerDraft,
  messageId: string,
  env: NodeJS.ProcessEnv,
): Promise<OdometerTurnResult> {
  if (!draft.unit || draft.valueNew == null || !draft.fechaLecturaIso || !draft.meterType) {
    return { kind: "reply", message: "Faltan datos para registrar. Empecemos de nuevo.", state };
  }
  if (!state.sessionToken) {
    return { kind: "reply", message: "No hay sesión WARA activa.", state };
  }

  const payloadHash = hashOdometerPayload({
    tenantId: state.tenantId,
    phone: state.phone,
    patente: draft.unit.patente,
    meterType: draft.meterType,
    valueNew: draft.valueNew,
    fechaLecturaIso: draft.fechaLecturaIso,
  });

  const dup = findCompletedByPayloadHash(state.odometerOperations ?? {}, payloadHash);
  if (dup) {
    return { kind: "reply", message: "Esa operación ya fue procesada (idempotencia).", state };
  }
  const dupConfirm = findCompletedByConfirmMessageId(state.odometerOperations ?? {}, messageId);
  if (dupConfirm) {
    return { kind: "reply", message: "Este CONFIRMO ya fue procesado.", state };
  }

  const dryRun = isPilotDryRun("odometer", env);
  const operationId = createOperationId();

  let result: { ok: boolean; error?: string; summary?: string; payload?: Record<string, unknown> };
  if (testDeps?.registerReading) {
    result = await testDeps.registerReading({
      sessionToken: state.sessionToken,
      patente: draft.unit.patente,
      meterType: draft.meterType,
      value: draft.valueNew,
      fechaIso: draft.fechaLecturaIso,
      dryRun,
    });
  } else {
    const wara = await registerOdometerHorometro(
      {
        sessionToken: state.sessionToken,
        patente: draft.unit.patente,
        meterType: draft.meterType,
        value: draft.valueNew,
        fechaLocalIso: draft.fechaLecturaIso,
      },
      env,
    );
    result = wara.ok
      ? { ok: true, summary: wara.summary, payload: wara.payload as Record<string, unknown> }
      : { ok: false, error: wara.error, payload: wara.payload as Record<string, unknown> };
  }

  const record = buildOperationRecord({
    operationId,
    messageId,
    tenantId: state.tenantId,
    phone: state.phone,
    unit: draft.unit,
    meterType: draft.meterType,
    valuePrevious: draft.valuePrevious,
    valueNew: draft.valueNew,
    fechaLecturaIso: draft.fechaLecturaIso,
    stateVersion: state.stateVersion,
    status: result.ok ? (dryRun ? "dry_run" : "written") : "failed",
    confirmMessageId: messageId,
    waraPayload: result.payload ?? null,
    resultSummary: result.ok ? (result.summary ?? null) : (result.error ?? null),
  });

  if (!state.odometerOperations) state.odometerOperations = {};
  state.odometerOperations[operationId] = record;

  void syncPilotOperationToPrisma({
    state,
    operationId,
    type: "update_odometer",
    gateKind: "odometer",
    messageId,
    payloadHash: record.payloadHash,
    payload: (result.payload ?? {}) as Record<string, unknown>,
    status: record.status,
    resultSummary: record.resultSummary,
    env,
  });

  state.odometerDraft = null;
  state.pendingConfirmation = null;
  state.activeTramite = "none";
  state.step = "idle";

  if (!result.ok) {
    return { kind: "reply", message: result.error ?? "WARA no pudo registrar el cambio.", state };
  }

  return {
    kind: "reply",
    message: dryRun
      ? `[Lab] Registro simulado OK — ${draft.unit.label}, ${draft.valueNew}. Sin escritura real.`
      : `Listo, registré ${draft.valueNew} en ${draft.unit.label}.`,
    state,
  };
}

export async function tryResolveOdometerTurn(input: {
  state: PilotConversationState;
  text: string;
  messageId: string;
  env: NodeJS.ProcessEnv;
  fleetUnits: WaraUnidadEstado[];
}): Promise<OdometerTurnResult> {
  const { state, text, messageId, env } = input;
  if (!state.odometerDraft) state.odometerDraft = emptyDraft();
  if (!state.odometerOperations) state.odometerOperations = {};

  const draft = state.odometerDraft;
  const meterTypeHint = draft.meterType ?? detectMeterTypeFromText(text) ?? "odometro";

  if (looksLikeCancelOdometer(text)) {
    state.odometerDraft = emptyDraft();
    state.pendingConfirmation = null;
    state.activeTramite = "none";
    state.step = "idle";
    return { kind: "reply", message: "Cancelé el registro de odómetro/horómetro.", state };
  }

  if (looksLikeOdometerSideInfoQuery(text) && state.pendingConfirmation?.action === "odometer_write") {
    return {
      kind: "reply",
      message:
        "El odómetro marca los km recorridos; el horómetro las horas de motor. " +
        `Seguimos con tu registro pendiente: ${state.pendingConfirmation.question}`,
      state,
    };
  }

  if (
    state.pendingConfirmation?.action === "odometer_write" &&
    draft.step === "await_confirm" &&
    looksLikeGpsReportRequest(text)
  ) {
    return { kind: "gps_side_during_odometer", text, state };
  }

  if (
    state.pendingConfirmation?.action === "odometer_write" &&
    (looksLikeResumePausedTramite(text) || looksLikePendingConfirmComprehensionAck(text))
  ) {
    return {
      kind: "reply",
      message: `Dale. ${state.pendingConfirmation.question}`,
      state,
    };
  }

  if (state.pendingConfirmation?.action === "odometer_write") {
    if (looksLikeExplicitReject(text) || looksLikeBriefRejection(text)) {
      state.pendingConfirmation = null;
      draft.step = "await_value";
      return { kind: "reply", message: "Ok, no registro. Decime el valor correcto cuando quieras.", state };
    }
    if (looksLikeExplicitConfirm(text) || looksLikeBriefConfirmation(text)) {
      return executeWrite(state, draft, messageId, env);
    }
    const corrected = extractNumericReading(text, draft.meterType);
    if (corrected != null && draft.meterType) {
      const val = validateReading(corrected, draft.meterType, { pendingConfirm: true });
      if (!val.ok) return { kind: "reply", message: val.reason, state };
      const retro = validateNoRetroceso(corrected, draft.valuePrevious);
      if (!retro.ok) return { kind: "reply", message: retro.reason, state };
      draft.valueNew = corrected;
      const q = buildConfirmQuestion(
        draft.unit!,
        draft.meterType,
        corrected,
        draft.fechaDisplay ?? "—",
        draft.valuePrevious,
      );
      state.pendingConfirmation = {
        action: "odometer_write",
        unit: draft.unit!,
        askedAt: new Date().toISOString(),
        question: q,
        operationId: state.pendingConfirmation.operationId,
      };
      return { kind: "reply", message: q, state };
    }
  }

  if (!looksLikeOdometerIntent(text) && draft.step === "idle" && state.activeTramite !== "odometer_update") {
    return { kind: "none" };
  }

  if (/\b(lectura\s+actual|valor\s+actual|cuanto\s+marca|cuánto\s+marca)\b/i.test(text) && draft.unit && draft.meterType) {
    return {
      kind: "reply",
      message: formatCurrentReading(draft.unit.label, draft.meterType, draft.valuePrevious),
      state,
    };
  }

  if (draft.step === "idle" || state.activeTramite === "none") {
    state.activeTramite = "odometer_update";
    draft.meterType = detectMeterTypeFromText(text) ?? draft.meterType ?? "odometro";
    draft.step = state.selectedUnit ? "await_value" : "await_unit";
    if (state.selectedUnit) {
      draft.unit = state.selectedUnit;
      const fleetUnit = findUnitInFleetByRef(input.fleetUnits, state.selectedUnit);
      if (fleetUnit) draft.valuePrevious = previousReading(fleetUnit, draft.meterType);
    }
  }

  if (draft.step === "await_unit") {
    if (state.selectedUnit) {
      draft.unit = state.selectedUnit;
      draft.step = "await_value";
      const fleetUnit = findUnitInFleetByRef(input.fleetUnits, state.selectedUnit);
      if (fleetUnit && draft.meterType) draft.valuePrevious = previousReading(fleetUnit, draft.meterType);
    } else {
      const ref = input.fleetUnits.find((u) => detectLoosePlateInFleet(text, u));
      if (ref) {
        draft.unit = toFleetUnitRef(ref);
        draft.step = "await_value";
        if (draft.meterType) draft.valuePrevious = previousReading(ref, draft.meterType);
      } else {
        return {
          kind: "reply",
          message: "Decime la patente o el nombre de la unidad para el odómetro/horómetro.",
          state,
        };
      }
    }
  }

  if (draft.step === "await_value") {
    const value = extractNumericReading(text, draft.meterType ?? meterTypeHint);
    if (value == null) {
      const prevMsg =
        draft.valuePrevious != null && draft.unit && draft.meterType
          ? ` ${formatCurrentReading(draft.unit.label, draft.meterType, draft.valuePrevious)}`
          : "";
      return {
        kind: "reply",
        message: `Pasame el valor del ${draft.meterType === "horometro" ? "horómetro (hs)" : "odómetro (km)"}.${prevMsg}`,
        state,
      };
    }
    const meterType = draft.meterType ?? meterTypeHint;
    const valCheck = validateReading(value, meterType, { explicitInMessage: true });
    if (!valCheck.ok) return { kind: "reply", message: valCheck.reason, state };
    const retro = validateNoRetroceso(value, draft.valuePrevious);
    if (!retro.ok) return { kind: "reply", message: retro.reason, state };
    draft.valueNew = value;
    draft.meterType = meterType;
    draft.step = "await_fecha";
    return {
      kind: "reply",
      message: "¿Con qué fecha y hora es la lectura? (ej. 06/08/2026 15:50)",
      state,
    };
  }

  if (draft.step === "await_fecha") {
    const TZ = "America/Argentina/Buenos_Aires";

    // Hora suelta + día ya guardado
    if (
      (draft.fechaDatePart || (draft.fechaLecturaIso && !fechaLecturaTieneHora(draft.fechaLecturaIso))) &&
      looksLikeClockTimeOnlyMessage(text)
    ) {
      const base =
        draft.fechaLecturaIso ??
        (draft.fechaDatePart ? `${draft.fechaDatePart}T00:00:00` : null);
      const merged = mergeFechaConHoraSuelt(base, text, TZ);
      if (merged) return finishFechaAndConfirm(state, draft, merged);
    }

    // Día relativo/numérico + hora ya guardada
    if (draft.fechaTimePart && !looksLikeClockTimeOnlyMessage(text)) {
      const parsed = parseFechaLectura(text, TZ);
      if (parsed) {
        const day = parsed.slice(0, 10);
        const combined = `${day}T${draft.fechaTimePart}`;
        return finishFechaAndConfirm(state, draft, combined);
      }
    }

    const fecha = parseFechaLectura(text, TZ);
    if (!fecha) {
      return {
        kind: "reply",
        message:
          "No entendí la fecha. Decime el día (ej. el domingo, ayer, 09/08/2026) y la hora (ej. 11:30).",
        state,
      };
    }

    // Solo hora (parse asume hoy) → pedir día
    if (looksLikeClockTimeOnlyMessage(text)) {
      draft.fechaTimePart = fecha.slice(11, 19);
      draft.fechaLecturaIso = null;
      draft.fechaDisplay = null;
      return {
        kind: "reply",
        message: `Perfecto, ${fecha.slice(11, 16)}. ¿De qué día es la lectura?`,
        state,
      };
    }

    // Solo día sin hora → pedir hora
    if (!fechaLecturaTieneHora(fecha, text)) {
      draft.fechaDatePart = fecha.slice(0, 10);
      draft.fechaLecturaIso = fecha;
      draft.fechaDisplay = formatFechaDisplay(fecha);
      const diaLargo = formatFechaDiaLargo(fecha, TZ);
      return {
        kind: "reply",
        message: `Perfecto, ${diaLargo}. ¿A qué hora?`,
        state,
      };
    }

    return finishFechaAndConfirm(state, draft, fecha);
  }

  return { kind: "none" };
}

function detectLoosePlateInFleet(text: string, unit: WaraUnidadEstado): boolean {
  const t = text.replace(/\s+/g, "").toUpperCase();
  const plate = (unit.patente ?? "").replace(/\s+/g, "").toUpperCase();
  const name = (unit.unidad ?? "").toUpperCase();
  return (plate.length >= 6 && t.includes(plate)) || (name.length >= 4 && t.includes(name));
}
