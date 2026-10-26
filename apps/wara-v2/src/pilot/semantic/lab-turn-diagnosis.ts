/**
 * Diagnóstico sanitizado del último turno (solo lab).
 */
export type LabTurnDiagnosis = {
  at: string;
  brain_version: "unified_v1" | "legacy_rules";
  action: string | null;
  intent: string | null;
  answer?: string | null;
  currentTramiteDisposition?: string | null;
  confidence: number | null;
  reasoningCode: string | null;
  handler: string | null;
  latency_ms: number | null;
  model: string | null;
  clarification: boolean;
  legacy_text_reclassification_attempted: boolean;
  legacy_reclass_reasons: string[];
  llm_called: boolean;
  error: string | null;
  stateBefore?: {
    activeTramite: string | null;
    pendingConfirmation: string | null;
    suspendedTramite: string | null;
  } | null;
  stateAfter?: {
    activeTramite: string | null;
    pendingConfirmation: string | null;
    suspendedTramite: string | null;
    certificateDraft: string | null;
  } | null;
};

let last: LabTurnDiagnosis | null = null;

export function recordLabTurnDiagnosis(d: LabTurnDiagnosis): void {
  last = d;
  console.info(
    JSON.stringify({
      event: "wara_v2_lab_turn_diagnosis",
      ...d,
    }),
  );
}

export function getLastLabTurnDiagnosis(): LabTurnDiagnosis | null {
  return last;
}
