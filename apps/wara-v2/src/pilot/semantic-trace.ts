/**
 * Trace local del cerebro conversacional V2.
 * Activar: WARA_V2_SEMANTIC_TRACE=true
 * Sin secretos, teléfonos completos ni API keys.
 */
import type { PilotConversationState } from "./conversation-state.js";
import type { TurnDecision } from "./turn-decision.js";
import type { SemanticTurn } from "./semantic-turn.js";

export type SemanticTraceRecord = {
  message: string;
  normalizedMessage: string;
  activeTramite: string;
  activeStep: string;
  lastQuestion: string | null;
  selectedUnit: string | null;
  suspendedTramite: string | null;
  pendingAction: string | null;
  /** ¿Se invocó OpenAI / modelo en este turno? */
  semanticInterpreterCalled: boolean;
  /** ¿Se ejecutó decideTurn / interpretSemanticTurn (reglas)? */
  ruleSemanticCalled: boolean;
  model: string | null;
  llmCallSite: string | null;
  semanticInputSummary: {
    hasLastQuestion: boolean;
    hasActiveTramite: boolean;
    hasSelectedUnit: boolean;
    hasPendingAction: boolean;
    hasSuspended: boolean;
    recentTurnsProvided: number;
  };
  turnDecision: TurnDecision | null;
  semanticOutput: SemanticTurn | null;
  deterministicRuleMatchedBeforeSemantic: string | null;
  handlerSelected: string | null;
  selectionReason: string | null;
  replyKind: string | null;
  replyPreview: string | null;
  stateTransition: { from: string; to: string };
  llmCallsInTurn: number;
};

type OpenTrace = {
  record: SemanticTraceRecord;
  fromLabel: string;
  closed: boolean;
};

const traces: SemanticTraceRecord[] = [];
let current: OpenTrace | null = null;
let llmCallsGlobal = 0;

function enabled(): boolean {
  const v = process.env.WARA_V2_SEMANTIC_TRACE?.trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

function norm(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function redactUnit(label: string | null | undefined): string | null {
  if (!label) return null;
  // Solo patente/código corto; sin IDs internos.
  return label.replace(/\([^)]*\)/g, "").trim().slice(0, 40) || null;
}

function stateLabel(state: PilotConversationState): string {
  const pending = state.pendingConfirmation?.action ?? "none";
  const draft =
    state.certificateDraft?.step && state.certificateDraft.step !== "idle"
      ? `cert:${state.certificateDraft.step}`
      : state.odometerDraft?.step && state.odometerDraft.step !== "idle"
        ? `odo:${state.odometerDraft.step}`
        : state.maintenanceDraft?.step && state.maintenanceDraft.step !== "idle"
          ? `maint:${state.maintenanceDraft.step}`
          : "draft:none";
  return `${state.activeTramite}|step=${state.step}|pending=${pending}|${draft}`;
}

export function isSemanticTraceEnabled(): boolean {
  return enabled();
}

export function clearSemanticTraces(): void {
  traces.length = 0;
  current = null;
  llmCallsGlobal = 0;
}

export function getSemanticTraces(): SemanticTraceRecord[] {
  return traces.slice();
}

export function beginSemanticTrace(text: string, state: PilotConversationState): void {
  if (!enabled()) return;
  const q = state.lastAgentQuestion ?? state.pendingConfirmation?.question ?? null;
  current = {
    closed: false,
    fromLabel: stateLabel(state),
    record: {
      message: text.slice(0, 200),
      normalizedMessage: norm(text).slice(0, 200),
      activeTramite: state.activeTramite,
      activeStep: state.step,
      lastQuestion: q ? q.slice(0, 160) : null,
      selectedUnit: redactUnit(state.selectedUnit?.label ?? state.selectedUnit?.patente),
      suspendedTramite: state.suspendedTramite?.tramite ?? null,
      pendingAction: state.pendingConfirmation?.action ?? null,
      semanticInterpreterCalled: false,
      ruleSemanticCalled: false,
      model: null,
      llmCallSite: null,
      semanticInputSummary: {
        hasLastQuestion: Boolean(q),
        hasActiveTramite: state.activeTramite !== "none",
        hasSelectedUnit: Boolean(state.selectedUnit),
        hasPendingAction: Boolean(state.pendingConfirmation),
        hasSuspended: Boolean(state.suspendedTramite),
        recentTurnsProvided: 0,
      },
      turnDecision: null,
      semanticOutput: null,
      deterministicRuleMatchedBeforeSemantic: null,
      handlerSelected: null,
      selectionReason: null,
      replyKind: null,
      replyPreview: null,
      stateTransition: { from: stateLabel(state), to: stateLabel(state) },
      llmCallsInTurn: 0,
    },
  };
}

export function traceRuleSemantic(input: {
  turnDecision?: TurnDecision | null;
  semantic?: SemanticTurn | null;
  deterministicBefore?: string | null;
}): void {
  if (!enabled() || !current || current.closed) return;
  current.record.ruleSemanticCalled = true;
  if (input.turnDecision !== undefined) current.record.turnDecision = input.turnDecision;
  if (input.semantic !== undefined) current.record.semanticOutput = input.semantic;
  if (input.deterministicBefore !== undefined) {
    current.record.deterministicRuleMatchedBeforeSemantic = input.deterministicBefore;
  }
}

/** Registrar llamada real a OpenAI (intérprete LLM). */
export function traceLlmCall(site: string, model: string): void {
  llmCallsGlobal += 1;
  if (!enabled() || !current || current.closed) return;
  current.record.semanticInterpreterCalled = true;
  current.record.model = model;
  current.record.llmCallSite = site;
  current.record.llmCallsInTurn += 1;
}

export function finishSemanticTrace(input: {
  state: PilotConversationState;
  handlerSelected: string;
  selectionReason: string;
  replyKind: string;
  replyPreview?: string | null;
}): void {
  if (!enabled() || !current || current.closed) return;
  current.record.handlerSelected = input.handlerSelected;
  current.record.selectionReason = input.selectionReason;
  current.record.replyKind = input.replyKind;
  current.record.replyPreview = input.replyPreview
    ? input.replyPreview.replace(/\+?\d{8,}/g, "[phone]").slice(0, 180)
    : null;
  current.record.stateTransition = {
    from: current.fromLabel,
    to: stateLabel(input.state),
  };
  current.closed = true;
  traces.push(current.record);
  current = null;
}

/** Si el turno terminó sin finish explícito. */
export function abandonSemanticTrace(state: PilotConversationState, reason: string): void {
  if (!enabled() || !current || current.closed) return;
  finishSemanticTrace({
    state,
    handlerSelected: "unfinished",
    selectionReason: reason,
    replyKind: "unknown",
  });
}

export function semanticTraceStats(): {
  turns: number;
  llmTurns: number;
  ruleOnlyTurns: number;
  llmPercent: number;
  llmCallsGlobal: number;
} {
  const turns = traces.length;
  const llmTurns = traces.filter((t) => t.semanticInterpreterCalled).length;
  return {
    turns,
    llmTurns,
    ruleOnlyTurns: turns - llmTurns,
    llmPercent: turns === 0 ? 0 : Math.round((llmTurns / turns) * 1000) / 10,
    llmCallsGlobal,
  };
}
