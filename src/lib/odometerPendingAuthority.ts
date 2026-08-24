/**
 * Autoridad de pending odometro/horómetro: meterType y turnLayer desde DB,
 * no re-inferidos desde hilo/overlay en continue_expected_field.
 *
 * Invariantes:
 * - Sin default silencioso a "odometro": nuevo pending exige meterType explícito;
 *   continuación conserva exclusivamente el autoritativo.
 * - XOR valor: horómetro no guarda odometro residual y viceversa.
 * - XOR turnLayer: activeExpectation / pendingClarification / fork_choice.
 */
import type { PendingActionRecord } from "@/lib/pendingAction";
import { getPendingAction, setPendingAction } from "@/lib/pendingAction";
import type { PrismaClient } from "@prisma/client";
import { readTurnLayer, type ActiveExpectationField } from "@/lib/turnLayerContract";

export type MeterKindAuthority = "horometro" | "odometro";

export function readAuthoritativeMeterType(
  pending: PendingActionRecord | null | undefined,
): MeterKindAuthority | null {
  if (!pending || pending.type !== "odometro") return null;
  const raw = pending.payload?.meterType ?? pending.payload?.meterKind;
  const m = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (m === "horometro" || m === "hourmeter") return "horometro";
  if (m === "odometro" || m === "odometer" || m === "km") return "odometro";
  return null;
}

function parseMeterTypeToken(raw: unknown): MeterKindAuthority | null {
  const m = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (m === "horometro" || m === "hourmeter") return "horometro";
  if (m === "odometro" || m === "odometer" || m === "km") return "odometro";
  return null;
}

/** ¿El turno continúa un medidor vivo en DB? (no reinicio en blanco). */
export function isAuthoritativeMeterContinuation(
  pending: PendingActionRecord | null | undefined,
): boolean {
  if (!pending || pending.type !== "odometro") return false;
  const p = pending.payload ?? {};
  const layer = readTurnLayer(pending);
  const exp = layer?.activeExpectation;
  if (exp === "fork_choice" || exp === "clarification") return true;
  if (exp === "km" || exp === "fecha_hora" || exp === "confirmo" || exp === "unit") return true;
  if (typeof p.horometro === "number" && Number.isFinite(p.horometro)) return true;
  if (typeof p.odometro === "number" && Number.isFinite(p.odometro)) return true;
  if (readAuthoritativeMeterType(pending)) return true;
  return false;
}

/**
 * Aplica autoridad DB sobre la inferencia de hilo.
 * Solo fork (pending limpiado / nuevo trámite) puede cambiar el kind.
 */
export function applyAuthoritativeMeterFlow(params: {
  pending: PendingActionRecord | null | undefined;
  pendingClearedThisTurn: boolean;
  horometerFlowActive: boolean;
}): boolean {
  if (params.pendingClearedThisTurn) return params.horometerFlowActive;
  const auth = readAuthoritativeMeterType(params.pending);
  if (auth === "horometro") return true;
  if (auth === "odometro") return false;
  return params.horometerFlowActive;
}

export function meterTopicLabel(meterType: MeterKindAuthority | null | undefined): string {
  return meterType === "horometro" ? "horómetro" : "odómetro";
}

/** XOR valor medidor: un kind no puede arrastrar el campo residual del otro. */
export function applyMeterValueXor(
  payload: Record<string, unknown>,
  meterType: MeterKindAuthority,
): Record<string, unknown> {
  const next = { ...payload };
  if (meterType === "horometro") {
    delete next.odometro;
  } else {
    delete next.horometro;
  }
  return next;
}

/**
 * XOR de capas: fork_choice / clarification / campo operativo son mutuamente excluyentes.
 */
export function applyTurnLayerXor(
  layer: Record<string, unknown>,
  activeExpectation: ActiveExpectationField | null | undefined,
): Record<string, unknown> {
  const next = { ...layer };
  if (activeExpectation === undefined) return next;

  next.activeExpectation = activeExpectation;

  if (activeExpectation === "fork_choice") {
    next.forkPending = true;
    next.pendingClarification = null;
    next.pausedExpectation = next.pausedExpectation ?? null;
    return next;
  }

  if (activeExpectation === "clarification") {
    next.forkPending = false;
    // pendingClarification lo aporta el caller; no inventar.
    return next;
  }

  if (activeExpectation === null) {
    next.forkPending = false;
    next.pendingClarification = null;
    return next;
  }

  // Campo operativo (unit/km/fecha_hora/confirmo/detail): limpia fork + clarificación.
  next.forkPending = false;
  next.pendingClarification = null;
  next.pausedExpectation = null;
  next.lateralPause = false;
  return next;
}

/**
 * Persiste pending odometro conservando metadata de control (turnLayer, stage, meterType).
 * @returns false si falta meterType, transición ilegal, o fallo de DB.
 */
export async function persistOdometerPendingState(params: {
  prisma: PrismaClient;
  phone: string;
  summary?: string;
  payloadPatch: Record<string, unknown>;
  activeExpectation?: ActiveExpectationField | null;
  stage?: string;
  /**
   * Obligatorio al crear pending nuevo.
   * En continuación se ignora si coincide; si difiere del autoritativo → fallo
   * (transición solo tras clear/fork).
   */
  meterType?: MeterKindAuthority | null;
}): Promise<boolean> {
  if (process.env.WARA_ODOMETER_FORCE_PERSIST_FAIL === "1") {
    console.error("[odometerPendingAuthority] forced persist fail (test hook)");
    return false;
  }

  const current = await getPendingAction(params.prisma, params.phone);
  const prevPayload =
    current?.type === "odometro" && current.payload && typeof current.payload === "object"
      ? { ...(current.payload as Record<string, unknown>) }
      : {};
  const prevLayer =
    prevPayload.turnLayer && typeof prevPayload.turnLayer === "object"
      ? { ...(prevPayload.turnLayer as Record<string, unknown>) }
      : {};

  const authPrev = readAuthoritativeMeterType(
    current?.type === "odometro" ? current : null,
  );
  const patchMeter = parseMeterTypeToken(params.payloadPatch.meterType);
  const requested = params.meterType ?? patchMeter ?? null;

  let meterType: MeterKindAuthority;
  if (authPrev) {
    // Continuación: solo el autoritativo. Cambiar kind exige clear/fork previo.
    if (requested && requested !== authPrev) {
      console.error("[odometerPendingAuthority] meterType transition without clear/fork", {
        phone: params.phone,
        authPrev,
        requested,
      });
      return false;
    }
    meterType = authPrev;
  } else {
    // Nuevo pending: meterType explícito obligatorio — nunca default a odómetro.
    if (!requested) {
      console.error("[odometerPendingAuthority] meterType required for new pending", {
        phone: params.phone,
      });
      return false;
    }
    meterType = requested;
  }

  let nextLayer: Record<string, unknown> = { ...prevLayer };
  if (params.activeExpectation !== undefined) {
    nextLayer = applyTurnLayerXor(nextLayer, params.activeExpectation);
  }

  const cleanPatch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params.payloadPatch)) {
    if (v !== undefined) cleanPatch[k] = v;
  }

  let mergedPayload: Record<string, unknown> = {
    ...prevPayload,
    ...cleanPatch,
    meterType,
    stage:
      params.stage ??
      (typeof cleanPatch.stage === "string"
        ? cleanPatch.stage
        : typeof prevPayload.stage === "string"
          ? prevPayload.stage
          : "collecting"),
    turnLayer: nextLayer,
  };

  if (params.activeExpectation === undefined && Object.keys(prevLayer).length > 0) {
    mergedPayload.turnLayer = { ...prevLayer, ...nextLayer };
  }

  mergedPayload = applyMeterValueXor(mergedPayload, meterType);

  return setPendingAction(params.prisma, params.phone, "odometro", {
    summary: params.summary ?? current?.summary,
    payload: mergedPayload,
  });
}
