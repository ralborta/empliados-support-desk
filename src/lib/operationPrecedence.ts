/**
 * Autoridad de precedencia entre write pendiente (DB) e inbound tipado.
 *
 * Alcance documentado (NO es “todos los servicios”):
 * - Write descriptors: odómetro, horómetro, certificado, mantenimiento.
 * - Read overlay: GPS/estado (y futuras reads registradas en el classifier de risk).
 * - Stateless / legacy `normal_route`: empresa, guías, flota, tickets, soporte, menús
 *   y cualquier servicio informativo sin descriptor write — aceptable por diseño.
 *
 * Orden fijo:
 *   resolve_pending_clarification (XOR DB existente)
 *   → expected field
 *   → read overlay
 *   → incompatible write fork
 *   → structured_clarification (apertura de aclaración NUEVA)
 *   → normal route
 *
 * Solo `normal_route` puede continuar al router/legacy de hilo.
 *
 * Separación de aclaraciones:
 * - hasPendingClarification: hay aclaración XOR vigente en DB → resolver.
 * - incomingStructuredClarification: pedir apertura de aclaración nueva.
 * - pendingClarificationChoice: lo entrega el upstream; la policy NO interpreta texto.
 *
 * Invariantes:
 *   !(incomingMatchesExpectedField && incomingActionRisk === "read")
 *   !(incomingMatchesExpectedField && incomingActionRisk === "write")
 */
import type { PendingActionRecord } from "@/lib/pendingAction";
import { readPendingClarification, readTurnLayer } from "@/lib/turnLayerContract";
import { isPendingWriteActionType } from "@/lib/pendingWriteInterference";

export type IncomingActionRisk = "read" | "write" | null;

/** Choice tipada por el upstream; la policy no parsea el mensaje del cliente. */
export type PendingClarificationChoice =
  | "status"
  | "continue"
  | "cancel"
  | "ambiguous"
  | null;

export type PrecedenceDecision =
  | "resolve_pending_clarification"
  | "continue_expected_field"
  | "overlay_read_keep_pending"
  | "fork_incompatible_write"
  | "structured_clarification"
  | "normal_route";

export type StructuredIncomingField =
  | "meter_value"
  | "datetime"
  | "unit_ref"
  | "confirmo"
  | "detail"
  | "fork_choice"
  | null;

export type OperationAuthority = {
  pendingOperation: string | null;
  pendingStage: string | null;
  activeExpectation: string | null;
  incomingActionRisk: IncomingActionRisk;
  /**
   * true solo si hay match op↔expectation↔field Y no hay intención conflictiva
   * (risk !== read && risk !== write) Y no hay aclaración XOR pendiente.
   */
  incomingMatchesExpectedField: boolean;
  /** Aclaración XOR vigente en DB (resolver antes de read/write general). */
  hasPendingClarification: boolean;
  /** Choice tipada del upstream para resolver la aclaración existente. */
  pendingClarificationChoice: PendingClarificationChoice;
  /**
   * Apertura de aclaración NUEVA (no hay pendingClarification en DB).
   * Distinto de hasPendingClarification.
   */
  incomingStructuredClarification: boolean;
};

export type TurnPrecedenceTrace = {
  pendingOperation: string | null;
  pendingStage: string | null;
  activeExpectation: string | null;
  incomingActionRisk: IncomingActionRisk;
  incomingMatchesExpectedField: boolean;
  hasPendingClarification: boolean;
  pendingClarificationChoice: PendingClarificationChoice;
  incomingStructuredClarification: boolean;
  structuredField: StructuredIncomingField;
  decision: PrecedenceDecision;
};

/**
 * Política única. Sin ramas por módulo. No interpreta texto.
 */
export function decideOperationPrecedence(a: OperationAuthority): PrecedenceDecision {
  // XOR: aclaración existente domina incluso antes de mirar pendingOperation genérico.
  if (a.hasPendingClarification) return "resolve_pending_clarification";
  if (!a.pendingOperation) return "normal_route";
  if (a.incomingMatchesExpectedField) return "continue_expected_field";
  if (a.incomingActionRisk === "read") return "overlay_read_keep_pending";
  if (a.incomingActionRisk === "write") return "fork_incompatible_write";
  if (a.incomingStructuredClarification) return "structured_clarification";
  return "normal_route";
}

export function isSemanticallyCompatibleField(params: {
  pendingOperation: string | null;
  activeExpectation: string | null;
  structuredField: StructuredIncomingField;
  incomingActionRisk?: IncomingActionRisk;
  hasPendingClarification?: boolean;
}): boolean {
  if (params.hasPendingClarification) return false;
  if (params.incomingActionRisk === "read" || params.incomingActionRisk === "write") {
    return false;
  }
  const { pendingOperation, activeExpectation, structuredField } = params;
  if (!pendingOperation || !activeExpectation || !structuredField) return false;
  // Durante clarification XOR no se consume campo operativo.
  if (activeExpectation === "clarification") return false;

  const isMeter =
    pendingOperation === "meter_odometro" || pendingOperation === "meter_horometro";
  const isWriteOp =
    isMeter ||
    pendingOperation === "certificados" ||
    pendingOperation === "mantenimiento";

  switch (activeExpectation) {
    case "km":
      return structuredField === "meter_value" && isMeter;
    case "fecha_hora":
      return structuredField === "datetime" && isWriteOp;
    case "unit":
      return (
        structuredField === "unit_ref" &&
        (isMeter ||
          pendingOperation === "certificados" ||
          pendingOperation === "mantenimiento")
      );
    case "detail":
      return structuredField === "detail" && pendingOperation === "mantenimiento";
    case "confirmo":
      return structuredField === "confirmo" && isWriteOp;
    case "fork_choice":
      return structuredField === "fork_choice";
    default:
      return false;
  }
}

export function assertOperationAuthorityInvariants(a: OperationAuthority): void {
  if (a.incomingMatchesExpectedField && a.incomingActionRisk === "read") {
    throw new Error(
      'operationPrecedence invariant: incomingMatchesExpectedField && incomingActionRisk === "read"',
    );
  }
  if (a.incomingMatchesExpectedField && a.incomingActionRisk === "write") {
    throw new Error(
      'operationPrecedence invariant: incomingMatchesExpectedField && incomingActionRisk === "write"',
    );
  }
  if (a.hasPendingClarification && a.incomingMatchesExpectedField) {
    throw new Error(
      "operationPrecedence invariant: hasPendingClarification && incomingMatchesExpectedField",
    );
  }
  if (a.hasPendingClarification && a.incomingStructuredClarification) {
    throw new Error(
      "operationPrecedence invariant: hasPendingClarification && incomingStructuredClarification (resolver ≠ abrir)",
    );
  }
}

export function resolvePendingOperationId(
  pending: PendingActionRecord | null | undefined,
): string | null {
  if (!pending || !isPendingWriteActionType(pending.type)) return null;
  if (pending.type === "certificados") return "certificados";
  if (pending.type === "mantenimiento") return "mantenimiento";
  if (pending.type === "odometro") {
    const payload = (pending.payload ?? {}) as Record<string, unknown>;
    const meter = String(payload.meterType ?? payload.meterKind ?? "").toLowerCase();
    if (meter === "horometro" || meter === "hourmeter") return "meter_horometro";
    return "meter_odometro";
  }
  return null;
}

export function readPendingStage(
  pending: PendingActionRecord | null | undefined,
): string | null {
  const stage = pending?.payload?.stage;
  return typeof stage === "string" && stage.trim() ? stage.trim() : null;
}

export function readActiveExpectationFromPending(
  pending: PendingActionRecord | null | undefined,
): string | null {
  const layer = readTurnLayer(pending);
  if (layer?.activeExpectation) return layer.activeExpectation;
  return null;
}

export function detectHasPendingClarification(
  pending: PendingActionRecord | null | undefined,
): boolean {
  const clarification = readPendingClarification(pending);
  const expectation = readActiveExpectationFromPending(pending);
  return Boolean(clarification) && expectation === "clarification";
}

/**
 * Construye autoridad a partir de DB + inbound ya tipado.
 * pendingClarificationChoice lo entrega el upstream (no se deriva aquí del texto).
 */
export function buildOperationAuthority(params: {
  pendingAction: PendingActionRecord | null | undefined;
  incomingActionRisk: IncomingActionRisk;
  structuredField: StructuredIncomingField;
  /** Choice tipada por upstream para aclaración existente. */
  pendingClarificationChoice?: PendingClarificationChoice;
  /** Solo apertura de aclaración NUEVA (sin XOR vigente). */
  incomingStructuredClarification?: boolean;
}): OperationAuthority {
  const pendingOperation = resolvePendingOperationId(params.pendingAction);
  const pendingStage = readPendingStage(params.pendingAction);
  const activeExpectation = readActiveExpectationFromPending(params.pendingAction);
  const hasPendingClarification = detectHasPendingClarification(params.pendingAction);

  const incomingMatchesExpectedField = isSemanticallyCompatibleField({
    pendingOperation,
    activeExpectation,
    structuredField: params.structuredField,
    incomingActionRisk: params.incomingActionRisk,
    hasPendingClarification,
  });

  const unitRefWhileExpectingNonUnit =
    !hasPendingClarification &&
    params.structuredField === "unit_ref" &&
    activeExpectation != null &&
    activeExpectation !== "unit" &&
    activeExpectation !== "clarification" &&
    activeExpectation !== "fork_choice";

  const incomingStructuredClarification =
    !hasPendingClarification &&
    (params.incomingStructuredClarification === true ||
      (unitRefWhileExpectingNonUnit && params.incomingActionRisk == null));

  const authority: OperationAuthority = {
    pendingOperation,
    pendingStage,
    activeExpectation,
    incomingActionRisk: params.incomingActionRisk,
    incomingMatchesExpectedField,
    hasPendingClarification,
    pendingClarificationChoice: hasPendingClarification
      ? (params.pendingClarificationChoice ?? null)
      : null,
    incomingStructuredClarification,
  };
  assertOperationAuthorityInvariants(authority);
  return authority;
}

export function buildTurnPrecedenceTrace(
  authority: OperationAuthority,
  structuredField: StructuredIncomingField,
  decision: PrecedenceDecision,
): TurnPrecedenceTrace {
  return {
    pendingOperation: authority.pendingOperation,
    pendingStage: authority.pendingStage,
    activeExpectation: authority.activeExpectation,
    incomingActionRisk: authority.incomingActionRisk,
    incomingMatchesExpectedField: authority.incomingMatchesExpectedField,
    hasPendingClarification: authority.hasPendingClarification,
    pendingClarificationChoice: authority.pendingClarificationChoice,
    incomingStructuredClarification: authority.incomingStructuredClarification,
    structuredField,
    decision,
  };
}

export function decidePendingWriteInterferenceCompat(input: {
  hasPendingWrite: boolean;
  incomingActionRisk: IncomingActionRisk;
  incomingMatchesExpectedField: boolean;
  incomingStructuredClarification?: boolean;
  hasPendingClarification?: boolean;
  pendingClarificationChoice?: PendingClarificationChoice;
}): PrecedenceDecision {
  if (!input.hasPendingWrite) return "normal_route";
  const match =
    input.incomingMatchesExpectedField &&
    input.incomingActionRisk !== "read" &&
    input.incomingActionRisk !== "write" &&
    !input.hasPendingClarification;
  return decideOperationPrecedence({
    pendingOperation: input.hasPendingWrite ? "pending_write" : null,
    pendingStage: null,
    activeExpectation: null,
    incomingActionRisk: input.incomingActionRisk,
    incomingMatchesExpectedField: match,
    hasPendingClarification: input.hasPendingClarification === true,
    pendingClarificationChoice: input.pendingClarificationChoice ?? null,
    incomingStructuredClarification:
      !input.hasPendingClarification && input.incomingStructuredClarification === true,
  });
}
