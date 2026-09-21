/**
 * Construye InterpretTurnInput desde estado piloto (sin secretos ni flota).
 */
import type { PilotConversationState } from "../conversation-state.js";
import type { InterpretTurnInput } from "./interpret-turn.js";
import { recentTurnsForInterpreter } from "./conversation-history.js";
import { buildCompanyContext } from "./turn-precedence.js";

const TZ = "America/Argentina/Buenos_Aires";

  const CAPABILITIES = [
  "unit_list",
  "unit_search",
  "gps",
  "odometer",
  "horometer",
  "maintenance",
  "certificate",
  "ticket",
  "human_handoff",
  "domain_knowledge",
  "query_active_company",
];

const REQUIRED: Record<string, string[]> = {
  odometer: ["numericValue", "date", "time"],
  horometer: ["numericValue", "date", "time"],
  certificate: ["unit"],
  maintenance: ["unit", "detail"],
  gps: ["unit"],
  ticket: ["detail"],
  unit_search: ["entity"],
  unit_list: [],
  human_handoff: ["detail"],
};

function draftSummary(state: PilotConversationState): Record<string, unknown> | undefined {
  if (state.odometerDraft && state.odometerDraft.step !== "idle") {
    const d = state.odometerDraft;
    return {
      kind: "odometer",
      step: d.step,
      meterType: d.meterType,
      valueNew: d.valueNew,
      fechaDatePart: d.fechaDatePart,
      fechaTimePart: d.fechaTimePart,
      hasFullFecha: Boolean(d.fechaLecturaIso),
    };
  }
  if (state.certificateDraft && state.certificateDraft.step !== "idle") {
    return { kind: "certificate", step: state.certificateDraft.step };
  }
  if (state.maintenanceDraft && state.maintenanceDraft.step !== "idle") {
    return {
      kind: "maintenance",
      step: state.maintenanceDraft.step,
      mode: state.maintenanceDraft.mode,
    };
  }
  return undefined;
}

export function buildInterpretTurnInput(
  message: string,
  state: PilotConversationState,
): InterpretTurnInput {
  const localNow = new Date().toLocaleString("sv-SE", { timeZone: TZ }).replace(" ", "T");
  const list = state.lastListing;
  const companyContext = buildCompanyContext(state);
  return {
    message,
    localNow,
    timezone: TZ,
    company: state.companyName
      ? { id: String(state.selectedContactId ?? ""), name: state.companyName }
      : undefined,
    companyContext,
    selectedUnit: state.selectedUnit
      ? {
          id: String(state.selectedUnit.movil_id),
          plate: state.selectedUnit.patente,
          name: state.selectedUnit.unidad,
        }
      : undefined,
    previousSelectedUnit: state.previousSelectedUnit
      ? {
          id: String(state.previousSelectedUnit.movil_id),
          plate: state.previousSelectedUnit.patente,
          name: state.previousSelectedUnit.unidad,
        }
      : undefined,
    proposedUnit: state.proposedUnit
      ? {
          id: String(state.proposedUnit.movil_id),
          plate: state.proposedUnit.patente,
          label: state.proposedUnit.label,
        }
      : undefined,
    activeTramite: state.activeTramite,
    activeStep: state.step,
    pendingConfirmation: state.pendingConfirmation
      ? {
          action: state.pendingConfirmation.action,
          question: state.pendingConfirmation.question.slice(0, 240),
        }
      : undefined,
    activeDraft: draftSummary(state),
    pendingEntityResolution: state.pendingEntityResolution
      ? {
          parentIntent: state.pendingEntityResolution.parentIntent,
          returnToStep: state.pendingEntityResolution.returnToStep,
          searchMode: state.pendingEntityResolution.searchMode ?? null,
          query: state.pendingEntityResolution.query ?? null,
        }
      : undefined,
    suspendedTramite: state.suspendedTramite
      ? { type: state.suspendedTramite.tramite, step: state.suspendedTramite.step }
      : undefined,
    lastAgentQuestion: state.lastAgentQuestion ?? state.pendingConfirmation?.question,
    lastAgentQuestionMeta: state.lastAgentQuestionMeta
      ? {
          id: state.lastAgentQuestionMeta.id,
          purpose: state.lastAgentQuestionMeta.purpose,
          expectedAnswerType: state.lastAgentQuestionMeta.expectedAnswerType,
          options: state.lastAgentQuestionMeta.options ?? null,
          pendingAction: state.lastAgentQuestionMeta.pendingAction ?? null,
        }
      : undefined,
    expectedAnswerType: state.lastAgentQuestionMeta?.expectedAnswerType ?? null,
    activeListSummary: list
      ? {
          type: list.kind,
          page: list.page,
          visibleIndexes: Array.from(
            { length: Math.min(list.pageSize, list.totalCount) },
            (_, i) => (list.page - 1) * list.pageSize + i + 1,
          ),
        }
      : undefined,
    recentTurns: recentTurnsForInterpreter(state),
    availableCapabilities: CAPABILITIES,
    requiredFieldsByCapability: REQUIRED,
  };
}
