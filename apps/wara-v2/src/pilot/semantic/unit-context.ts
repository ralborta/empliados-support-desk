/**
 * Contexto de unidad activa y resolución de referencias contextuales.
 * Evita: listado → índice 1 silencioso; «la misma» mal resuelta; bucles de clarify.
 */
import type { PilotConversationState, PilotSelectedUnit } from "../conversation-state.js";
import { toFleetUnitRef, type FleetUnitRef } from "../unit-fleet.js";
import type { WaraUnidadEstado } from "../wara-types.js";
import type { TurnDecision } from "./turn-decision-schema.js";

export type UnitSelectionSource =
  | "explicit_plate"
  | "list_index"
  | "contextual_reference"
  | "active_context"
  | null;

export type UnitEntityReference =
  | "selected_unit"
  | "previous_selected_unit"
  | "last_mentioned_unit"
  | "current_list_item"
  | "same_as_before";

export type UnitClarificationState = {
  questionId: string;
  candidates: PilotSelectedUnit[];
  attempts: number;
  lastQuestion: string;
};

export type ResolveUnitResult =
  | { kind: "unit"; unit: WaraUnidadEstado; source: UnitSelectionSource; reference?: UnitEntityReference }
  | { kind: "propose"; unit: WaraUnidadEstado; insteadOf: PilotSelectedUnit; source: UnitSelectionSource }
  | { kind: "clarify"; message: string; candidates: PilotSelectedUnit[] }
  | { kind: "restore"; unit: PilotSelectedUnit; message: string }
  | { kind: "none"; message: string };

function norm(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function refsEqual(a: PilotSelectedUnit | null | undefined, b: PilotSelectedUnit | null | undefined): boolean {
  if (!a || !b) return false;
  return a.movil_id === b.movil_id || a.patente === b.patente;
}

export function commitSelectedUnit(
  state: PilotConversationState,
  unit: WaraUnidadEstado | PilotSelectedUnit,
  source: UnitSelectionSource,
): PilotSelectedUnit {
  const ref: PilotSelectedUnit =
    "patente" in unit && "label" in unit && !("odometro" in unit)
      ? (unit as PilotSelectedUnit)
      : toFleetUnitRef(unit as WaraUnidadEstado);
  if (state.selectedUnit && !refsEqual(state.selectedUnit, ref)) {
    state.previousSelectedUnit = state.selectedUnit;
  }
  state.selectedUnit = ref;
  state.proposedUnit = null;
  state.lastMentionedUnit = ref;
  state.selectionSource = source;
  state.confirmedFields.unit = ref.label;
  state.unitClarificationState = null;
  return ref;
}

export function mentionUnit(state: PilotConversationState, unit: WaraUnidadEstado | PilotSelectedUnit): void {
  const ref: PilotSelectedUnit =
    "patente" in unit && "label" in unit && !("odometro" in unit)
      ? (unit as PilotSelectedUnit)
      : toFleetUnitRef(unit as WaraUnidadEstado);
  state.lastMentionedUnit = ref;
}

export function proposeUnit(
  state: PilotConversationState,
  unit: WaraUnidadEstado,
  insteadOf: PilotSelectedUnit,
): string {
  const ref = toFleetUnitRef(unit);
  state.proposedUnit = ref;
  state.lastMentionedUnit = ref;
  state.selectionSource = null;
  return (
    `Encontré ${ref.label}. ¿Querés usar esta unidad en lugar de ${insteadOf.label}?\n` +
    `Respondé sí para cambiar, o «la anterior» / «la que tenía seleccionada» para conservar ${insteadOf.label}.`
  );
}

export function clearProposedUnit(state: PilotConversationState): void {
  state.proposedUnit = null;
}

export function clearUnitContext(state: PilotConversationState): void {
  state.selectedUnit = null;
  state.previousSelectedUnit = null;
  state.lastMentionedUnit = null;
  state.proposedUnit = null;
  state.selectionSource = null;
  state.unitClarificationState = null;
}

/** Inferencia de reference desde el mensaje (genérica, no una sola frase). */
export function inferEntityReference(text: string): UnitEntityReference | null {
  const t = norm(text);
  if (!t) return null;

  if (
    /\b(no\s+era\s+esa|no\s+es\s+esa|no\s+esa|esa\s+no|incorrecta|equivocad)\b/.test(t) ||
    /\b(volve|volvé|volver)\s+(a\s+)?(la\s+)?(anterior|de\s+antes)\b/.test(t) ||
    /\b(la\s+que\s+tenia|la\s+que\s+tenía|la\s+que\s+tenia\s+seleccionada|la\s+que\s+tenía\s+seleccionada)\b/.test(
      t,
    ) ||
    /\b(la\s+anterior|la\s+de\s+antes|la\s+previa|same_as_before)\b/.test(t)
  ) {
    return "previous_selected_unit";
  }

  if (
    /\b(la\s+misma(\s+unidad)?|de\s+la\s+misma(\s+unidad)?|esa\s+misma|esa\s+unidad|esa|ese|la\s+seleccionada|la\s+activa)\b/.test(
      t,
    )
  ) {
    return "selected_unit";
  }

  if (/\b(la\s+mencionada|la\s+ultima\s+mencionada|última\s+mencionada)\b/.test(t)) {
    return "last_mentioned_unit";
  }

  return null;
}

export function looksLikeUnitStatusOfActive(text: string): boolean {
  const t = norm(text);
  if (!t) return false;
  if (/\b(list(a|ame|ar)|todas|flota|mostrame\s+unidades|ver\s+unidades)\b/.test(t)) {
    return false;
  }
  return (
    /\b(estado|reporte|gps|ubicacion|ubicaci[oó]n|donde\s+esta|d[oó]nde\s+est[aá]|como\s+esta|c[oó]mo\s+est[aá])\b/.test(
      t,
    ) && /\b(unidad|la\s+unidad|esa\s+unidad|el\s+movil|el\s+m[oó]vil)\b/.test(t)
  );
}

export function looksLikeUnitCorrection(text: string): boolean {
  return inferEntityReference(text) === "previous_selected_unit";
}

function findInFleet(
  fleet: WaraUnidadEstado[],
  ref: PilotSelectedUnit | null | undefined,
): WaraUnidadEstado | null {
  if (!ref) return null;
  return (
    fleet.find((u) => u.movil_id === ref.movil_id) ||
    fleet.find(
      (u) =>
        String(u.patente ?? "")
          .replace(/[\s\-_.]/g, "")
          .toUpperCase() ===
        String(ref.patente ?? "")
          .replace(/[\s\-_.]/g, "")
          .toUpperCase(),
    ) ||
    null
  );
}

function nextClarifyMessage(
  state: PilotConversationState,
  candidates: PilotSelectedUnit[],
): { message: string; attempts: number } {
  const prev = state.unitClarificationState;
  const attempts = (prev?.attempts ?? 0) + 1;
  const a = candidates[0];
  const b = candidates[1];
  let message: string;
  if (attempts === 1) {
    message = a && b
      ? `¿Te referís a ${a.label} o a ${b.label}?`
      : a
        ? `¿Seguimos con ${a.label}?`
        : "¿A qué unidad te referís? Decime la patente.";
  } else if (attempts === 2 && a && b) {
    message = `Elegí una opción:\n1. ${a.label}\n2. ${b.label}`;
  } else {
    const keep = state.previousSelectedUnit ?? state.selectedUnit ?? a;
    if (keep) {
      message =
        `Para no dar vueltas, sigo con ${keep.label} (la unidad confirmada).\n` +
        `Si necesitás otra, decime la patente o pedí hablar con un asesor.`;
      commitSelectedUnit(state, keep, "active_context");
    } else {
      message =
        "No pude identificar la unidad. Decime la patente exacta o pedí hablar con un asesor.";
    }
  }
  state.unitClarificationState = {
    questionId: `unit-clarify-${attempts}`,
    candidates,
    attempts,
    lastQuestion: message,
  };
  return { message, attempts };
}

/**
 * Resuelve referencia contextual / corrección sin caer al índice 1 del listado.
 */
export function resolveContextualUnitReference(
  state: PilotConversationState,
  fleet: WaraUnidadEstado[],
  opts: {
    reference?: UnitEntityReference | null;
    message?: string;
    allowProposeReplace?: boolean;
  },
): ResolveUnitResult {
  const message = opts.message ?? "";
  const reference = opts.reference ?? inferEntityReference(message);

  // Corrección / undo: priorizar previous o descartar proposed.
  if (reference === "previous_selected_unit" || looksLikeUnitCorrection(message)) {
    if (state.proposedUnit && state.selectedUnit) {
      clearProposedUnit(state);
      state.unitClarificationState = null;
      return {
        kind: "restore",
        unit: state.selectedUnit,
        message: `Entendido. Seguimos con ${state.selectedUnit.label}, que era la unidad seleccionada.`,
      };
    }
    const prev = state.previousSelectedUnit;
    if (prev) {
      const fleetUnit = findInFleet(fleet, prev);
      if (fleetUnit) {
        commitSelectedUnit(state, fleetUnit, "contextual_reference");
        return {
          kind: "restore",
          unit: state.selectedUnit!,
          message: `Entendido. Seguimos con ${state.selectedUnit!.label}, que era la unidad seleccionada.`,
        };
      }
      commitSelectedUnit(state, prev, "contextual_reference");
      return {
        kind: "restore",
        unit: prev,
        message: `Entendido. Seguimos con ${prev.label}, que era la unidad seleccionada.`,
      };
    }
    if (state.selectedUnit) {
      clearProposedUnit(state);
      return {
        kind: "restore",
        unit: state.selectedUnit,
        message: `Entendido. Seguimos con ${state.selectedUnit.label}, que era la unidad seleccionada.`,
      };
    }
    const candidates = [state.proposedUnit, state.lastMentionedUnit].filter(Boolean) as PilotSelectedUnit[];
    const { message: clarify } = nextClarifyMessage(state, candidates);
    return { kind: "clarify", message: clarify, candidates };
  }

  if (reference === "selected_unit" || reference === "same_as_before") {
    if (state.selectedUnit) {
      const fleetUnit = findInFleet(fleet, state.selectedUnit);
      if (fleetUnit) {
        return { kind: "unit", unit: fleetUnit, source: "contextual_reference", reference };
      }
      // Sin flota: devolver restore conceptual vía unit sintetizado no aplica;
      // aclarar.
      return {
        kind: "restore",
        unit: state.selectedUnit,
        message: `Seguimos con ${state.selectedUnit.label}.`,
      };
    }
    if (state.previousSelectedUnit) {
      const fleetUnit = findInFleet(fleet, state.previousSelectedUnit);
      if (fleetUnit) {
        commitSelectedUnit(state, fleetUnit, "contextual_reference");
        return { kind: "unit", unit: fleetUnit, source: "contextual_reference", reference };
      }
    }
    const { message: clarify } = nextClarifyMessage(state, []);
    return { kind: "clarify", message: clarify, candidates: [] };
  }

  if (reference === "last_mentioned_unit" && state.lastMentionedUnit) {
    const fleetUnit = findInFleet(fleet, state.lastMentionedUnit);
    if (fleetUnit) {
      return { kind: "unit", unit: fleetUnit, source: "contextual_reference", reference };
    }
  }

  if (reference === "current_list_item") {
    // Solo con índice explícito en otro camino; nunca default al 1.
    const { message: clarify } = nextClarifyMessage(
      state,
      [state.selectedUnit, state.previousSelectedUnit].filter(Boolean) as PilotSelectedUnit[],
    );
    return { kind: "clarify", message: clarify, candidates: [] };
  }

  // Sin reference clara: si hay selected, usarla; si no, aclarar (nunca índice 1).
  if (state.selectedUnit) {
    const fleetUnit = findInFleet(fleet, state.selectedUnit);
    if (fleetUnit) {
      return { kind: "unit", unit: fleetUnit, source: "active_context", reference: "selected_unit" };
    }
  }

  const candidates = [state.selectedUnit, state.previousSelectedUnit, state.proposedUnit].filter(
    Boolean,
  ) as PilotSelectedUnit[];
  const { message: clarify } = nextClarifyMessage(state, candidates);
  return { kind: "clarify", message: clarify, candidates };
}

/**
 * Tras resolver una unidad nueva cuando ya hay selected distinta:
 * proponer cambio en vez de pisar en silencio (exploración).
 */
export function applyResolvedUnit(
  state: PilotConversationState,
  unit: WaraUnidadEstado,
  source: UnitSelectionSource,
  opts?: { forceCommit?: boolean; parentIntent?: string | null },
): ResolveUnitResult {
  const hasParent = Boolean(opts?.parentIntent);
  if (
    !opts?.forceCommit &&
    !hasParent &&
    state.selectedUnit &&
    state.selectedUnit.movil_id !== unit.movil_id
  ) {
    return {
      kind: "propose",
      unit,
      insteadOf: state.selectedUnit,
      source,
    };
  }
  commitSelectedUnit(state, unit, source);
  return { kind: "unit", unit, source };
}

export function confirmProposedUnit(
  state: PilotConversationState,
  fleet: WaraUnidadEstado[],
): ResolveUnitResult {
  if (!state.proposedUnit) {
    return { kind: "none", message: "No hay una unidad propuesta para confirmar." };
  }
  const fleetUnit = findInFleet(fleet, state.proposedUnit);
  if (!fleetUnit) {
    commitSelectedUnit(state, state.proposedUnit, "contextual_reference");
    return {
      kind: "restore",
      unit: state.selectedUnit!,
      message: `Listo, ahora la unidad activa es ${state.selectedUnit!.label}.`,
    };
  }
  commitSelectedUnit(state, fleetUnit, "contextual_reference");
  return { kind: "unit", unit: fleetUnit, source: "contextual_reference" };
}

/** Snapshot para build-context / diagnosis. */
export function unitContextSnapshot(state: PilotConversationState): Record<string, unknown> {
  return {
    selectedUnit: state.selectedUnit
      ? { patente: state.selectedUnit.patente, label: state.selectedUnit.label }
      : null,
    previousSelectedUnit: state.previousSelectedUnit
      ? { patente: state.previousSelectedUnit.patente, label: state.previousSelectedUnit.label }
      : null,
    lastMentionedUnit: state.lastMentionedUnit
      ? { patente: state.lastMentionedUnit.patente, label: state.lastMentionedUnit.label }
      : null,
    proposedUnit: state.proposedUnit
      ? { patente: state.proposedUnit.patente, label: state.proposedUnit.label }
      : null,
    selectionSource: state.selectionSource ?? null,
    clarificationAttempts: state.unitClarificationState?.attempts ?? 0,
  };
}

export function entityReferenceFromDecision(
  decision: TurnDecision,
  message: string,
): UnitEntityReference | null {
  const ref = decision.entity?.reference ?? null;
  if (ref) return ref;
  if (decision.entity?.type === "contextual") {
    return inferEntityReference(message) ?? "selected_unit";
  }
  if (decision.reasoningCode === "CONTEXTUAL_REFERENCE") {
    return inferEntityReference(message);
  }
  return inferEntityReference(message);
}
