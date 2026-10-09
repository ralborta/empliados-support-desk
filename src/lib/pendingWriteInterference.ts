/**
 * Política central de interferencia V1: escritura pendiente vs acción entrante.
 *
 * No recibe texto original. No usa regex/includes/palabras clave.
 * Decide solo con metadata estructurada (riesgo + estado).
 *
 * RIESGO ARQUITECTÓNICO (documentado, no mitigado aquí):
 * Esta policy no serializa turnos por teléfono. El ledger de delivery es por
 * wamid (idempotencia del mismo inbound), no FIFO por teléfono. allowPhoneRequest
 * es rate-limit, no mutex. shouldDeferTurnExecutor solo difiere async.
 * Turnos concurrentes del mismo teléfono pueden intercalar mutaciones de
 * pendingAction/activeUnit. Una cola/mutex por teléfono sería un cambio
 * separado; no simular que el ledger lo resuelve.
 */
import type { PendingActionRecord } from "@/lib/pendingAction";
import type { TypedLateralKind } from "@/lib/typedLateralQueries";
import type { ActiveUnitRecord } from "@/lib/activeUnit";
import { readTurnLayer } from "@/lib/turnLayerContract";
import { formatPlateWithSpaces } from "@/lib/wara";

export type ActionWriteRisk = "read" | "write";

export type InterferenceDecision =
  | "continue_expected_field"
  | "overlay_read_keep_pending"
  | "fork_incompatible_write"
  | "normal_route";

export type InterferenceInput = {
  hasPendingWrite: boolean;
  incomingActionRisk: ActionWriteRisk;
  incomingMatchesExpectedField: boolean;
};

/**
 * Autoridad única de interferencia read/write.
 * Orden: campo esperado → overlay read → fork write → normal.
 */
export function decidePendingWriteInterference(input: InterferenceInput): InterferenceDecision {
  if (!input.hasPendingWrite) return "normal_route";
  if (input.incomingMatchesExpectedField) return "continue_expected_field";
  if (input.incomingActionRisk === "read") return "overlay_read_keep_pending";
  return "fork_incompatible_write";
}

/** Laterales tipadas existentes son consultas informativas (riesgo read). */
export function actionRiskFromTypedLateralKind(kind: TypedLateralKind | null | undefined): ActionWriteRisk | null {
  if (!kind) return null;
  return "read";
}

/** Tipos de pendingAction que cuentan como escritura en curso. */
export function isPendingWriteActionType(
  type: PendingActionRecord["type"] | string | null | undefined,
): boolean {
  return type === "odometro" || type === "certificados" || type === "mantenimiento";
}

export type DeclarativeResumeHintContext = {
  meterKind?: "horometro" | "odometro" | null;
  plateDisplay?: string | null;
  writeKind?: "odometro" | "certificados" | "mantenimiento" | null;
  /** Expectativa operativa actual (post-relectura). */
  activeExpectation?: string | null;
  /** stage del payload (collecting / confirmed / etc.). */
  stage?: string | null;
};

/**
 * Pista declarativa de reanudación (sin pregunta / sin nueva expectativa).
 * Los valores vienen del contexto estructurado del trámite, no de frases fijas de aceptación.
 * Devuelve null si el trámite ya no está pendiente de recolección (omitir hint).
 */
export function buildDeclarativePendingWriteResumeHint(
  ctx: DeclarativeResumeHintContext,
): string | null {
  const stage = String(ctx.stage ?? "").toLowerCase();
  if (
    !ctx.writeKind ||
    stage.includes("cancel") ||
    stage.includes("complet") ||
    stage.includes("done") ||
    stage.includes("confirmed") ||
    stage === "success"
  ) {
    return null;
  }

  const plateRaw = ctx.plateDisplay?.trim();
  const plate = plateRaw
    ? formatPlateWithSpaces(plateRaw.replace(/\s+/g, "")) ?? plateRaw
    : null;
  const expectation = ctx.activeExpectation ?? null;

  if (ctx.writeKind === "certificados") {
    return plate
      ? `El certificado de ${plate} sigue pendiente.`
      : "El certificado sigue pendiente.";
  }
  if (ctx.writeKind === "mantenimiento") {
    return plate
      ? `El mantenimiento de ${plate} sigue pendiente.`
      : "El mantenimiento sigue pendiente.";
  }

  const isHoro = ctx.meterKind === "horometro";
  const topic = isHoro ? "horómetro" : "odómetro";

  // Si ya no espera km/horas, no volver a pedirlas.
  if (expectation === "fecha_hora") {
    return plate
      ? `El cambio de ${topic} de ${plate} sigue pendiente; falta la fecha/hora de la lectura.`
      : `El cambio de ${topic} sigue pendiente; falta la fecha/hora de la lectura.`;
  }
  if (expectation === "confirmo") {
    return plate
      ? `El cambio de ${topic} de ${plate} sigue pendiente de confirmación (CONFIRMO).`
      : `El cambio de ${topic} sigue pendiente de confirmación (CONFIRMO).`;
  }
  if (expectation === "fork_choice" || expectation === "clarification") {
    return plate
      ? `El cambio de ${topic} de ${plate} sigue pendiente.`
      : `El cambio de ${topic} sigue pendiente.`;
  }
  if (expectation && expectation !== "km" && expectation !== "unit" && expectation !== "detail") {
    // Expectativa desconocida / trámite avanzó sin campo de medidor → no inventar "pasame horas".
    return plate
      ? `El cambio de ${topic} de ${plate} sigue pendiente.`
      : `El cambio de ${topic} sigue pendiente.`;
  }

  const fieldHint = isHoro ? "las horas" : "el kilometraje";
  if (plate) {
    return `El cambio de ${topic} de ${plate} sigue pendiente; podés continuar enviando ${fieldHint}.`;
  }
  return `El cambio de ${topic} sigue pendiente; podés continuar enviando ${fieldHint}.`;
}

/**
 * Resume hint desde pending re-leído tras overlay (no snapshot previo).
 * null si no hay escritura pendiente o el trámite terminó/canceló.
 */
export function buildOverlayResumeHintFromCurrentPending(opts: {
  pendingAction: PendingActionRecord | null | undefined;
  pendingKind?: string | null;
  threadText?: string;
  plateDisplayFallback?: string | null;
}): string | null {
  const pending = opts.pendingAction ?? null;
  if (!isPendingWriteActionType(pending?.type) && !opts.pendingKind) {
    return null;
  }
  const writeKind =
    pending?.type === "certificados" || opts.pendingKind === "certificados"
      ? "certificados"
      : pending?.type === "mantenimiento" || opts.pendingKind === "mantenimiento"
        ? "mantenimiento"
        : pending?.type === "odometro" || opts.pendingKind === "odometro"
          ? "odometro"
          : null;
  if (!writeKind) return null;

  const payload = (pending?.payload ?? {}) as Record<string, unknown>;
  const stage = typeof payload.stage === "string" ? payload.stage : null;
  const turnLayer = readTurnLayer(pending);
  const plateFromPayload =
    (typeof payload.plate === "string" && payload.plate) ||
    (typeof payload.patente === "string" && payload.patente) ||
    null;
  const meterKindRaw = payload.meterKind ?? payload.meterType;
  const meterKind =
    meterKindRaw === "horometro" || meterKindRaw === "odometro"
      ? meterKindRaw
      : null;

  let activeExpectation = turnLayer?.activeExpectation ?? null;
  const hasMeterValue =
    (typeof payload.horometro === "number" && Number.isFinite(payload.horometro)) ||
    (typeof payload.odometro === "number" && Number.isFinite(payload.odometro)) ||
    (typeof payload.km === "number" && Number.isFinite(payload.km));
  // Si el valor del medidor ya está y aún figura km, adaptar: no re-pedir horas/km.
  if (hasMeterValue && (activeExpectation === "km" || activeExpectation == null)) {
    activeExpectation = "fecha_hora";
  }

  return buildDeclarativePendingWriteResumeHint({
    writeKind,
    meterKind,
    plateDisplay: plateFromPayload ?? opts.plateDisplayFallback ?? null,
    activeExpectation,
    stage,
  });
}

/** Une cuerpo de overlay + pista declarativa. Nunca agrega “¿seguimos?”. */
export function composeOverlayReadKeepPendingReply(
  lateralBody: string,
  resumeHint: string | null | undefined,
): string {
  const body = String(lateralBody ?? "").trim();
  const hint = String(resumeHint ?? "").trim();
  if (!body) return hint;
  if (!hint) return body;
  if (body.includes(hint)) return body;
  return `${body}\n\n${hint}`;
}

/** Sin falsa continuidad si falló persistir pendingClarification. */
export function buildUnitRefClarificationPersistFailureReply(
  unitLabel?: string | null,
): string {
  const ref = String(unitLabel ?? "").trim();
  if (ref) {
    return (
      `Tomé la referencia *${ref}*, pero no pude guardar el contexto ahora. ` +
      `El trámite en curso sigue igual; si querés el estado/GPS de esa unidad, pedilo de nuevo en un momento.`
    );
  }
  return (
    "No pude guardar el contexto de la aclaración ahora. " +
    "El trámite en curso sigue igual; si querés consultar GPS de otra unidad, pedilo de nuevo en un momento."
  );
}

export type V1PendingWriteFingerprint = {
  pendingActionType: string | null;
  pendingActionCreatedAt: string | null;
  pendingActionPayload: unknown;
  turnLayer: unknown;
  activeExpectation: string | null;
  pausedExpectation: string | null;
  forkPending: boolean | null;
  tramiteUnitPlate: string | null;
  activeUnit: ActiveUnitRecord | null;
  pendingConfirmationKind: string | null;
};

export function fingerprintV1PendingWriteState(opts: {
  pendingAction: PendingActionRecord | null | undefined;
  activeUnit?: ActiveUnitRecord | null;
  tramiteUnitPlate?: string | null;
  pendingConfirmationKind?: string | null;
}): V1PendingWriteFingerprint {
  const pending = opts.pendingAction ?? null;
  const turnLayer = readTurnLayer(pending);
  return {
    pendingActionType: pending?.type ?? null,
    pendingActionCreatedAt: pending?.createdAt ?? null,
    pendingActionPayload: pending?.payload ?? null,
    turnLayer: turnLayer ?? null,
    activeExpectation: turnLayer?.activeExpectation ?? null,
    pausedExpectation: turnLayer?.pausedExpectation ?? null,
    forkPending: turnLayer?.forkPending ?? null,
    tramiteUnitPlate: opts.tramiteUnitPlate ?? null,
    activeUnit: opts.activeUnit ?? null,
    pendingConfirmationKind: opts.pendingConfirmationKind ?? null,
  };
}

export function fingerprintsDeepEqual(
  a: V1PendingWriteFingerprint,
  b: V1PendingWriteFingerprint,
): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
