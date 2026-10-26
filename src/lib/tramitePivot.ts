/**
 * Pivot de consulta de estado/GPS durante trámite de odómetro/horómetro en recolección.
 * Fork sin escrituras hasta que el cliente elige «consultar ahora» vs «seguir con …».
 */
import type { PrismaClient } from "@prisma/client";
import type { PendingActionRecord } from "@/lib/pendingAction";
import type { ActiveExpectationField, TurnLayerPayload } from "@/lib/turnLayerContract";
import type { TramiteForkChoice } from "@/lib/turnLayerContract";
import {
  extractPlateFromOdometerSummary,
  extractPlateFromPerfectoTomo,
  extractLastPlateFromThread,
  extractUnitCodeNumbersFromMessage,
  detectLoosePlate,
  normalizePlate,
  isPlausibleVehiclePlate,
  formatPlateWithSpaces,
  threadAwaitingHorometerKmValue,
  threadAwaitingHorometerPlate,
  threadAwaitingOdometerKmValue,
} from "@/lib/wara";
import {
  consultarEstadoUnidades,
  looksLikeGpsOrUnitStatusQuestion,
  looksLikeLiveUnitConsultIntent,
  resolveCustomerByWaraPhone,
  resolveWaraSessionByPhone,
  type WaraUnidadEstado,
} from "@/lib/waraApi";
import {
  extractExplicitUnitNameFromText,
  extractMovilIdFromUnitMessage,
} from "@/lib/waraUnitIntent";
import { isExplicitUnitStatusQuery } from "@/lib/tramiteMeterPrecedence";
import {
  classifyTramiteForkChoiceResponse,
  looksLikeTramiteForkResumeIntent,
  readTurnLayer,
} from "@/lib/turnLayerContract";

export type PivotUnitRefKind = "internal" | "plate" | "unit_code";

export type PivotUnitRef = {
  kind: PivotUnitRefKind;
  value: string;
};

export type PivotIntent = {
  kind: "unit_status";
  unitRef: PivotUnitRef;
  originalText: string;
  resolvedLabel?: string;
  resolvedPlate?: string;
  resolvedMovilId?: number;
  createdAt: string;
  companyContactId?: number;
};

export type TramiteUnitAnchor = {
  plate?: string;
  movilId?: number;
  unitCode?: string;
  displayLabel: string;
};

export const PIVOT_INTENT_TTL_MS = 45 * 60 * 1000;

export function logTramitePivotTrace(entry: Record<string, unknown>): void {
  console.info("[tramite-pivot]", JSON.stringify(entry));
}

export function isPivotIntentFresh(pivot: PivotIntent | null | undefined, now = Date.now()): boolean {
  if (!pivot?.createdAt) return false;
  const t = Date.parse(pivot.createdAt);
  return Number.isFinite(t) && now - t <= PIVOT_INTENT_TTL_MS;
}

export function readPivotIntent(
  pendingAction: PendingActionRecord | null | undefined,
): PivotIntent | null {
  const raw = pendingAction?.payload?.pivotIntent;
  if (!raw || typeof raw !== "object") return null;
  const pivot = raw as PivotIntent;
  if (pivot.kind !== "unit_status" || !pivot.originalText || !pivot.unitRef) return null;
  if (!isPivotIntentFresh(pivot)) return null;
  return pivot;
}

export function pivotCompanyStillValid(
  pivot: PivotIntent,
  companyContactId: number | null | undefined,
): boolean {
  if (pivot.companyContactId == null || companyContactId == null) return true;
  return pivot.companyContactId === companyContactId;
}

export function extractPivotUnitRefFromText(text: string): PivotUnitRef | null {
  const raw = String(text ?? "").trim();
  if (!raw) return null;
  const movilId = extractMovilIdFromUnitMessage(raw);
  if (movilId != null) return { kind: "internal", value: String(movilId) };
  const unitCodes = extractUnitCodeNumbersFromMessage(raw);
  if (unitCodes.length > 0) return { kind: "internal", value: String(unitCodes[0]) };
  const plate = detectLoosePlate(raw);
  const normPlate = plate ? normalizePlate(plate) : null;
  if (normPlate && isPlausibleVehiclePlate(normPlate)) {
    return { kind: "plate", value: normPlate };
  }
  const unitCode = extractExplicitUnitNameFromText(raw);
  if (unitCode) return { kind: "unit_code", value: unitCode };
  return null;
}

export function buildPivotIntentFromStatusText(
  text: string,
  companyContactId?: number | null,
): PivotIntent | null {
  if (!isExplicitUnitStatusQuery(text)) return null;
  const unitRef = extractPivotUnitRefFromText(text);
  if (!unitRef) return null;
  return {
    kind: "unit_status",
    unitRef,
    originalText: String(text ?? "").trim(),
    createdAt: new Date().toISOString(),
    ...(companyContactId != null ? { companyContactId } : {}),
  };
}

function plateNorm(p: string | undefined | null): string {
  return String(p ?? "")
    .replace(/\s+/g, "")
    .toUpperCase();
}

function unitDisplayFromFleet(unit: WaraUnidadEstado): string {
  const plate = unit.patente?.trim();
  const name = unit.unidad?.trim();
  if (plate && name && plateNorm(plate) !== plateNorm(name)) {
    return `${formatPlateWithSpaces(plateNorm(plate)) ?? plateNorm(plate)} (${name})`;
  }
  return plate
    ? (formatPlateWithSpaces(plateNorm(plate)) ?? plateNorm(plate))
    : name || "la unidad";
}

function matchFleetUnit(unitRef: PivotUnitRef, units: WaraUnidadEstado[]): WaraUnidadEstado | null {
  if (unitRef.kind === "internal") {
    const target = parseInt(unitRef.value, 10);
    if (!Number.isFinite(target)) return null;
    const hits = units.filter((u) => Number(u.movil_id) === target);
    if (hits.length === 1) return hits[0];
    return null;
  }
  if (unitRef.kind === "plate") {
    const wanted = plateNorm(unitRef.value);
    const hits = units.filter((u) => plateNorm(u.patente) === wanted || plateNorm(u.unidad) === wanted);
    if (hits.length === 1) return hits[0];
    return null;
  }
  if (unitRef.kind === "unit_code") {
    const code = unitRef.value.replace(/\s+/g, "").toUpperCase();
    const hits = units.filter((u) => {
      const uName = String(u.unidad ?? "")
        .replace(/\s+/g, "")
        .toUpperCase();
      return uName === code || uName.includes(code);
    });
    if (hits.length === 1) return hits[0];
    return null;
  }
  return null;
}

export async function enrichPivotIntentWithFleet(
  prisma: PrismaClient,
  rawPhone: string,
  pivot: PivotIntent,
): Promise<PivotIntent> {
  const session = await resolveWaraSessionByPhone(prisma, rawPhone);
  if (!session.ok || !session.sessionToken) return pivot;
  const fleet = await consultarEstadoUnidades(session.sessionToken, []);
  if (!fleet.ok || fleet.unidades.length === 0) return pivot;
  const unit = matchFleetUnit(pivot.unitRef, fleet.unidades);
  if (!unit) return pivot;
  const plate = plateNorm(unit.patente);
  return {
    ...pivot,
    resolvedLabel: unitDisplayFromFleet(unit),
    resolvedPlate: plate || undefined,
    resolvedMovilId: typeof unit.movil_id === "number" ? unit.movil_id : undefined,
  };
}

export function pivotDisplayLabel(pivot: PivotIntent): string {
  if (pivot.resolvedLabel?.trim()) return pivot.resolvedLabel.trim();
  if (pivot.unitRef.kind === "plate") {
    return formatPlateWithSpaces(pivot.unitRef.value) ?? pivot.unitRef.value;
  }
  if (pivot.unitRef.kind === "unit_code") return pivot.unitRef.value;
  return `interno ${pivot.unitRef.value}`;
}

export function extractTramiteUnitAnchorFromThread(threadText: string): TramiteUnitAnchor | null {
  const plate =
    extractPlateFromOdometerSummary(threadText) ??
    extractPlateFromPerfectoTomo(threadText) ??
    extractLastPlateFromThread(threadText);
  const unitLineMatches = [...threadText.matchAll(/(?:🚗\s*)?\*?Unidad:\*?\s*([^\n*]+)/gi)];
  let displayFromLine: string | undefined;
  for (let i = unitLineMatches.length - 1; i >= 0; i--) {
    const line = unitLineMatches[i][1]?.replace(/\*/g, "").trim();
    if (line) {
      displayFromLine = line;
      break;
    }
  }
  if (plate) {
    const norm = plateNorm(plate);
    return {
      plate: norm,
      displayLabel: displayFromLine ?? formatPlateWithSpaces(norm) ?? norm,
    };
  }
  if (displayFromLine) {
    const loose = detectLoosePlate(displayFromLine);
    if (loose && isPlausibleVehiclePlate(normalizePlate(loose))) {
      const norm = plateNorm(loose);
      return { plate: norm, displayLabel: displayFromLine };
    }
    return { displayLabel: displayFromLine, unitCode: displayFromLine };
  }
  return null;
}

export function isHorometerTramiteContext(threadText: string): boolean {
  if (threadAwaitingHorometerPlate(threadText) || threadAwaitingHorometerKmValue(threadText)) {
    return true;
  }
  const tail = threadText.slice(-2000).toLowerCase();
  return /\bhor[oó]metro\b/.test(tail) && !/\bod[oó]metro\b/.test(tail.slice(-800));
}

export function tramiteTopicLabel(isHoro: boolean): string {
  return isHoro ? "horómetro" : "odómetro";
}

export function pivotTargetsSameTramiteUnit(
  tramite: TramiteUnitAnchor,
  pivot: PivotIntent,
): boolean {
  const tramitePlate = tramite.plate ? plateNorm(tramite.plate) : "";
  const pivotPlate = pivot.resolvedPlate
    ? plateNorm(pivot.resolvedPlate)
    : pivot.unitRef.kind === "plate"
      ? plateNorm(pivot.unitRef.value)
      : "";
  if (tramitePlate && pivotPlate && tramitePlate === pivotPlate) return true;
  if (
    tramite.movilId != null &&
    pivot.resolvedMovilId != null &&
    tramite.movilId === pivot.resolvedMovilId
  ) {
    return true;
  }
  if (
    tramite.movilId != null &&
    pivot.unitRef.kind === "internal" &&
    String(tramite.movilId) === pivot.unitRef.value
  ) {
    return true;
  }
  if (tramite.unitCode && pivot.unitRef.kind === "unit_code") {
    const a = tramite.unitCode.replace(/\s+/g, "").toUpperCase();
    const b = pivot.unitRef.value.replace(/\s+/g, "").toUpperCase();
    if (a === b) return true;
  }
  const tramiteDisplay = tramite.displayLabel.replace(/\s+/g, "").toUpperCase();
  const pivotDisplay = pivotDisplayLabel(pivot).replace(/\s+/g, "").toUpperCase();
  if (tramiteDisplay && pivotDisplay && tramiteDisplay === pivotDisplay) return true;
  return false;
}

export function buildCrossUnitPivotForkMessage(
  threadText: string,
  tramiteUnit: TramiteUnitAnchor,
  pivot: PivotIntent,
): string {
  const isHoro = isHorometerTramiteContext(threadText);
  const topic = tramiteTopicLabel(isHoro);
  const tramiteLabel = tramiteUnit.displayLabel;
  const pivotLabel = pivotDisplayLabel(pivot);
  return [
    `Estás con el *cambio de ${topic}* de *${tramiteLabel}*.`,
    `Pediste el *estado* de *${pivotLabel}*.`,
    "",
    "¿Qué preferís?",
    `• *Consultar ahora* — cancelamos el cambio de ${topic} y consultamos ${pivotLabel}.`,
    `• *Seguir con ${topic}* — terminamos ${tramiteLabel} primero.`,
  ].join("\n");
}

export function buildPivotForkClarificationReply(threadText: string): string {
  const isHoro = isHorometerTramiteContext(threadText);
  const topic = tramiteTopicLabel(isHoro);
  return (
    `Para seguir: decime *consultar ahora* (cancelamos el ${topic} y consultamos la otra unidad) o *seguir con ${topic}* (terminamos el cambio primero).`
  );
}

function normForkText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[¡!¿?.,;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Respuestas inequívocas + compatibilidad con fork lateral genérico. */
export function classifyPivotForkChoiceResponse(text: string): TramiteForkChoice | null {
  const raw = String(text ?? "").trim();
  if (!raw) return null;
  const t = normForkText(raw);
  const consultNow =
    /\bconsultar ahora\b/.test(t) ||
    /\bcancelamos\b.{0,48}\b(consultar|estado|gps|unidad)\b/.test(t) ||
    /\bconsulta primero\b/.test(t);
  const resumeTramite =
    /\bseguir con\b.{0,24}\b(horometro|odometro)\b/.test(t) ||
    /\bterminamos primero\b/.test(t) ||
    looksLikeTramiteForkResumeIntent(raw);
  if (consultNow && resumeTramite) return "ambiguous";
  if (consultNow) return "switch";
  if (resumeTramite) return "resume";
  return classifyTramiteForkChoiceResponse(raw);
}

export function threadAwaitingPivotForkChoice(threadText: string): boolean {
  const tail = threadText.slice(-3200);
  if (/\bconsultar ahora\b/i.test(tail) && /\bseguir con\b/i.test(tail)) return true;
  return /\bcambiar de requerimiento\b/i.test(tail) && /\bseguimos con el\b/i.test(tail);
}

export function buildCollectingPayloadForPivot(
  threadText: string,
  pivot: PivotIntent,
  existingPayload?: Record<string, unknown> | null,
): Record<string, unknown> {
  const pausedExpectation =
    inferPausedExpectationForPivot(threadText, existingPayload) ?? "unit";
  const prevLayer = (existingPayload?.turnLayer as TurnLayerPayload | undefined) ?? {};
  return {
    ...(existingPayload ?? {}),
    stage: existingPayload?.stage ?? "collecting",
    pivotIntent: pivot,
    turnLayer: {
      ...prevLayer,
      activeExpectation: "fork_choice",
      forkPending: true,
      lateralPause: true,
      pausedExpectation,
    },
  };
}

export function inferPausedExpectationForPivot(
  threadText: string,
  existingPayload?: Record<string, unknown> | null,
): ActiveExpectationField {
  const layer = (existingPayload?.turnLayer as TurnLayerPayload | undefined) ?? {};
  if (layer.pausedExpectation) return layer.pausedExpectation;
  if (threadAwaitingHorometerKmValue(threadText) || threadAwaitingOdometerKmValue(threadText)) {
    return "km";
  }
  if (looksLikeFechaHoraLecturaPendingInThread(threadText)) return "fecha_hora";
  return "unit";
}

function looksLikeFechaHoraLecturaPendingInThread(threadText: string): boolean {
  const tail = threadText.slice(-2500).toLowerCase();
  return (
    /\bfecha\b.{0,40}\bhora\b/.test(tail) ||
    /\bfecha\/hora\b/.test(tail) ||
    /\bfecha y hora\b/.test(tail)
  );
}

export function buildResumeTurnLayerPatch(
  pendingAction: PendingActionRecord | null | undefined,
): TurnLayerPayload {
  const layer = readTurnLayer(pendingAction) ?? {};
  const restored = layer.pausedExpectation ?? "unit";
  return {
    forkPending: false,
    lateralPause: false,
    activeExpectation: restored,
    pausedExpectation: null,
  };
}

export async function prepareStatusPivotDuringTramite(params: {
  prisma: PrismaClient;
  rawPhone: string;
  selectionText: string;
  threadText: string;
  pendingAction: PendingActionRecord | null;
}): Promise<
  | { kind: "same_unit_lateral" }
  | { kind: "overlay_read" }
  | { kind: "fork"; message: string; pivot: PivotIntent }
  | null
> {
  const { prisma, rawPhone, selectionText, threadText, pendingAction } = params;
  if (!isExplicitUnitStatusQuery(selectionText)) return null;
  if (!looksLikeGpsOrUnitStatusQuestion(selectionText) && !looksLikeLiveUnitConsultIntent(selectionText)) {
    return null;
  }

  let companyContactId: number | undefined;
  try {
    const resolution = await resolveCustomerByWaraPhone(prisma, rawPhone);
    companyContactId = resolution.customer?.selectedCompanyContactId ?? undefined;
  } catch {
    companyContactId = undefined;
  }

  let pivot = buildPivotIntentFromStatusText(selectionText, companyContactId);
  if (!pivot) return null;

  try {
    pivot = await enrichPivotIntentWithFleet(prisma, rawPhone, pivot);
  } catch {
    // Flota no disponible: igual se puede decidir overlay de lectura.
  }

  if (!pivotCompanyStillValid(pivot, companyContactId)) {
    logTramitePivotTrace({
      decision: "pivot_invalid_company",
      pivotUnit: pivot.unitRef.value,
    });
    return null;
  }

  const tramiteUnit = extractTramiteUnitAnchorFromThread(threadText);
  if (tramiteUnit && pivotTargetsSameTramiteUnit(tramiteUnit, pivot)) {
    logTramitePivotTrace({
      decision: "same_unit_lateral",
      tramite: tramiteUnit.displayLabel,
      pivot: pivotDisplayLabel(pivot),
    });
    return { kind: "same_unit_lateral" };
  }

  if (!tramiteUnit) return null;

  // Lectura (estado/GPS) durante escritura: overlay, nunca fork.
  // El fork queda reservado a write/write vía decidePendingWriteInterference.
  void pendingAction;
  logTramitePivotTrace({
    decision: "overlay_read_keep_pending",
    tramite: tramiteUnit.displayLabel,
    pivot: pivotDisplayLabel(pivot),
  });
  return { kind: "overlay_read" };
}
