/**
 * Adapters/descriptors de operaciones write sobre executors V1 existentes.
 * No reescriben odometro/certificados/mantenimiento: solo tipan inbound,
 * hacen match semántico y delegan al executor correspondiente.
 *
 * Clasificación de servicios (alcance A — no afirmar “todos los servicios”):
 * - Write descriptors: meter_odometro, meter_horometro, certificados, mantenimiento.
 * - Read overlay: GPS/estado (classifyIncomingActionRisk → "read"); futuras reads
 *   se registran ahí, no como write descriptors.
 * - Stateless / legacy normal_route: empresa, guías, flota, tickets, soporte, menús
 *   y demás informativos sin pending write — salen por normal_route a propósito.
 */
import type { PendingActionRecord } from "@/lib/pendingAction";
import type { TurnExecutorId } from "@/lib/whatsappTurnRouter";
import {
  looksLikeBareMeterValue,
  looksLikeCertificateKeyword,
  looksLikeHorometerOnlyIntent,
  looksLikeMaintenanceKeyword,
  looksLikePendingTramiteAffirmation,
  looksLikeBriefConfirmation,
  looksLikeExplicitOdometerUpdateRequest,
  detectLoosePlate,
  normalizePlate,
  isPlausibleVehiclePlate,
  extractPlatePrefixFromMessage,
} from "@/lib/wara";
import {
  looksLikeGpsOrUnitStatusQuestion,
  looksLikeLiveUnitConsultIntent,
  looksLikeOperationalMaintenanceIntent,
} from "@/lib/waraApi";
import { looksLikeFechaHoraLecturaMessage } from "@/lib/odometroFecha";
import { looksLikeClockTimeOnlyReading } from "@/lib/odometroHorometroExtract";
import {
  extractMovilIdFromUnitMessage,
  looksLikeFleetUnitSearchInput,
} from "@/lib/waraUnitIntent";
import { shouldRouteGpsConsultToUnidades } from "@/lib/gpsConsultRouting";
import { isPendingWriteActionType } from "@/lib/pendingWriteInterference";
import {
  buildOperationAuthority,
  buildTurnPrecedenceTrace,
  decideOperationPrecedence,
  detectHasPendingClarification,
  readActiveExpectationFromPending,
  resolvePendingOperationId,
  type IncomingActionRisk,
  type OperationAuthority,
  type PendingClarificationChoice,
  type PrecedenceDecision,
  type StructuredIncomingField,
  type TurnPrecedenceTrace,
} from "@/lib/operationPrecedence";
import {
  classifyUnitRefClarificationChoice,
  readTurnLayer,
} from "@/lib/turnLayerContract";

export type OperationModuleDescriptor = {
  id: string;
  risk: "read" | "write";
  stages: readonly string[];
  expectedFields: readonly string[];
  executor: TurnExecutorId;
  overlayReadTools: readonly TurnExecutorId[];
};

const METER_STAGES = [
  "collecting",
  "missing_value_fecha_hora",
  "horometro_awaiting_hours",
  "missing_plate",
  "awaiting_confirm",
  "unit_clarification",
] as const;

export const OPERATION_MODULE_ADAPTERS: Record<string, OperationModuleDescriptor> = {
  meter_odometro: {
    id: "meter_odometro",
    risk: "write",
    stages: METER_STAGES,
    expectedFields: ["unit", "km", "fecha_hora", "confirmo", "fork_choice", "clarification"],
    executor: "odometro",
    overlayReadTools: ["unidades"],
  },
  meter_horometro: {
    id: "meter_horometro",
    risk: "write",
    stages: METER_STAGES,
    expectedFields: ["unit", "km", "fecha_hora", "confirmo", "fork_choice", "clarification"],
    executor: "odometro",
    overlayReadTools: ["unidades"],
  },
  certificados: {
    id: "certificados",
    risk: "write",
    stages: ["awaiting_unit", "confirmation_required", "collecting"],
    expectedFields: ["unit", "confirmo", "fork_choice", "clarification"],
    executor: "certificados",
    overlayReadTools: ["unidades"],
  },
  mantenimiento: {
    id: "mantenimiento",
    risk: "write",
    stages: ["awaiting_unit", "collecting", "awaiting_detail", "confirmation_required"],
    expectedFields: ["unit", "detail", "fecha_hora", "confirmo", "fork_choice", "clarification"],
    executor: "mantenimiento",
    overlayReadTools: ["unidades"],
  },
};

export function getOperationModuleAdapter(
  pendingOperation: string | null,
): OperationModuleDescriptor | null {
  if (!pendingOperation) return null;
  return OPERATION_MODULE_ADAPTERS[pendingOperation] ?? null;
}

export function executorForPendingOperation(pendingOperation: string | null): TurnExecutorId | null {
  return getOperationModuleAdapter(pendingOperation)?.executor ?? null;
}

/** Tipado estructural del inbound (sin autoridad de hilo). */
export function classifyStructuredIncomingField(
  selectionText: string,
  threadText = "",
): StructuredIncomingField {
  const text = String(selectionText ?? "").trim();
  if (!text) return null;

  if (
    looksLikePendingTramiteAffirmation(text) ||
    looksLikeBriefConfirmation(text) ||
    /^confirm[oó]\b/i.test(text)
  ) {
    return "confirmo";
  }

  if (
    looksLikeFechaHoraLecturaMessage(text) ||
    looksLikeClockTimeOnlyReading(text) ||
    /\b(hoy|ayer|anteayer)\b/i.test(text)
  ) {
    return "datetime";
  }

  if (looksLikeBareMeterValue(text)) {
    return "meter_value";
  }

  const plate = normalizePlate(detectLoosePlate(text) ?? "");
  if (plate && isPlausibleVehiclePlate(plate)) return "unit_ref";
  if (extractMovilIdFromUnitMessage(text, { threadText }) != null) return "unit_ref";
  if (extractPlatePrefixFromMessage(text)) return "unit_ref";
  // Interno corto / código flota sin ser bare meter de 1–7 ya cubierto arriba.
  if (/^m?\d{3,4}-\d{2,4}$/i.test(text.replace(/\s+/g, ""))) return "unit_ref";
  if (looksLikeFleetUnitSearchInput(text, threadText) && !looksLikeBareMeterValue(text)) {
    return "unit_ref";
  }

  // Detalle libre de mantenimiento: texto sustantivo sin ser read/write de otro servicio.
  if (
    text.length >= 8 &&
    !looksLikeGpsOrUnitStatusQuestion(text) &&
    !looksLikeLiveUnitConsultIntent(text) &&
    !looksLikeCertificateKeyword(text) &&
    !looksLikeExplicitOdometerUpdateRequest(text) &&
    !looksLikeHorometerOnlyIntent(text)
  ) {
    return "detail";
  }

  return null;
}

export function classifyIncomingActionRisk(
  selectionText: string,
  pendingOperation: string | null,
): IncomingActionRisk {
  const text = String(selectionText ?? "").trim();
  if (!text) return null;

  // Read explícito (GPS/estado) tiene prioridad sobre tokens de unidad embebidos.
  if (
    looksLikeGpsOrUnitStatusQuestion(text) ||
    looksLikeLiveUnitConsultIntent(text) ||
    shouldRouteGpsConsultToUnidades(text)
  ) {
    return "read";
  }

  const explicitCert = looksLikeCertificateKeyword(text);
  const explicitMaint =
    looksLikeMaintenanceKeyword(text) || looksLikeOperationalMaintenanceIntent(text);
  const explicitMeter =
    looksLikeExplicitOdometerUpdateRequest(text) || looksLikeHorometerOnlyIntent(text);

  if (explicitCert && pendingOperation !== "certificados") return "write";
  if (explicitMaint && pendingOperation !== "mantenimiento") return "write";
  if (
    explicitMeter &&
    pendingOperation !== "meter_odometro" &&
    pendingOperation !== "meter_horometro"
  ) {
    return "write";
  }
  // Mismo dominio write explícito (reinicio): fork — nunca consumir como detail/campo.
  // Política A: fork_incompatible_write (no auto-reinicio silencioso).
  if (explicitCert || explicitMaint || explicitMeter) return "write";

  return null;
}

/**
 * Si la expectativa de valor/fecha está en DB pero stage viejo no trae turnLayer,
 * inferir expectation mínima desde stage/payload (sin historial de hilo).
 */
export function coerceActiveExpectationFromPayload(
  pending: PendingActionRecord | null | undefined,
): PendingActionRecord | null | undefined {
  if (!pending || !isPendingWriteActionType(pending.type)) return pending;
  const layer = readTurnLayer(pending);
  if (layer?.activeExpectation) return pending;

  const payload = { ...(pending.payload ?? {}) } as Record<string, unknown>;
  const stage = String(payload.stage ?? "").toLowerCase();
  const meterType = String(payload.meterType ?? payload.meterKind ?? "").toLowerCase();
  const hasPatente =
    (typeof payload.patente === "string" && payload.patente.trim()) ||
    (typeof payload.plate === "string" && payload.plate.trim());

  let activeExpectation: string | null = null;
  if (pending.type === "odometro") {
    if (
      stage.includes("confirm") ||
      stage === "awaiting_confirm" ||
      payload.summaryConfirmo === true
    ) {
      activeExpectation = "confirmo";
    } else if (
      stage.includes("missing_value") ||
      stage.includes("awaiting_hours") ||
      stage === "collecting" ||
      (hasPatente && !stage.includes("missing_plate"))
    ) {
      const hasMeter =
        typeof payload.horometro === "number" ||
        typeof payload.odometro === "number" ||
        typeof payload.km === "number";
      activeExpectation = hasMeter ? "fecha_hora" : "km";
    } else if (stage.includes("missing_plate") || stage.includes("unit")) {
      activeExpectation = "unit";
    } else if (hasPatente && (meterType === "horometro" || meterType === "odometro" || meterType)) {
      // Persistencia histórica sin stage: patente + meterType ⇒ esperando valor.
      activeExpectation = "km";
    }
  } else if (pending.type === "certificados") {
    if (stage.includes("confirm")) activeExpectation = "confirmo";
    else activeExpectation = "unit";
  } else if (pending.type === "mantenimiento") {
    if (stage.includes("confirm")) activeExpectation = "confirmo";
    else if (stage.includes("detail") || stage.includes("fecha")) activeExpectation = "detail";
    else activeExpectation = "unit";
  }

  if (!activeExpectation) return pending;
  return {
    ...pending,
    payload: {
      ...payload,
      turnLayer: {
        ...((payload.turnLayer as Record<string, unknown>) ?? {}),
        activeExpectation,
      },
    },
  };
}

export type PrecedenceClassifyResult = {
  authority: OperationAuthority;
  decision: PrecedenceDecision;
  structuredField: StructuredIncomingField;
  trace: TurnPrecedenceTrace;
  adapter: OperationModuleDescriptor | null;
};

/**
 * Upstream: tipa choice de aclaración existente. La policy no ve el texto crudo.
 */
export function resolvePendingClarificationChoiceUpstream(
  selectionText: string,
  hasPendingClarification: boolean,
): PendingClarificationChoice {
  if (!hasPendingClarification) return null;
  return classifyUnitRefClarificationChoice(selectionText);
}

export function classifyOperationPrecedence(params: {
  pendingAction: PendingActionRecord | null | undefined;
  selectionText: string;
  threadText?: string;
  /** Override tipado (tests / callers que ya clasificaron). */
  pendingClarificationChoice?: PendingClarificationChoice;
}): PrecedenceClassifyResult {
  const pendingCoerced = coerceActiveExpectationFromPayload(params.pendingAction);
  const pendingOperation = resolvePendingOperationId(pendingCoerced);
  const activeExpectation = readActiveExpectationFromPending(pendingCoerced);
  const hasPendingClarification = detectHasPendingClarification(pendingCoerced);
  let structuredField = classifyStructuredIncomingField(
    params.selectionText,
    params.threadText ?? "",
  );
  if (
    activeExpectation === "unit" &&
    structuredField === "meter_value" &&
    looksLikeBareMeterValue(params.selectionText)
  ) {
    structuredField = "unit_ref";
  }
  const incomingActionRisk = classifyIncomingActionRisk(params.selectionText, pendingOperation);
  const pendingClarificationChoice =
    params.pendingClarificationChoice !== undefined
      ? params.pendingClarificationChoice
      : resolvePendingClarificationChoiceUpstream(params.selectionText, hasPendingClarification);

  const authority = buildOperationAuthority({
    pendingAction: pendingCoerced,
    incomingActionRisk,
    structuredField,
    pendingClarificationChoice,
  });
  const decision = decideOperationPrecedence(authority);
  const adapter = getOperationModuleAdapter(authority.pendingOperation);
  return {
    authority,
    decision,
    structuredField,
    trace: buildTurnPrecedenceTrace(authority, structuredField, decision),
    adapter,
  };
}

export function buildIncompatibleWriteForkReply(pendingOperation: string | null): string {
  const label =
    pendingOperation === "certificados"
      ? "certificado"
      : pendingOperation === "mantenimiento"
        ? "mantenimiento"
        : pendingOperation === "meter_horometro"
          ? "horómetro"
          : pendingOperation === "meter_odometro"
            ? "odómetro"
            : "trámite";
  return [
    `Estás con un trámite de *${label}* en curso.`,
    "Pediste otro requerimiento incompatible.",
    "",
    "¿Qué preferís?",
    "• *Cambiar de requerimiento* — dejamos el trámite actual y arrancamos el nuevo.",
    "• *Seguir con el trámite* — terminamos lo pendiente primero.",
  ].join("\n");
}
