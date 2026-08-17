/**
 * Matriz de paridad: enrichers/resolvers Commander V3 vs bridge Runtime Next.
 * Actualizar al incorporar nuevas piezas operativas.
 */
export type ParityRow = {
  function: string;
  module: string;
  reusedInNext: boolean;
  replacedJustified: boolean;
  uncovered: boolean;
  notes: string;
};

export const OPERATIONAL_PARITY_MATRIX: ParityRow[] = [
  {
    function: "enrichPlanForCompanyChange",
    module: "commander-v3/enrich/company-change.ts",
    reusedInNext: true,
    replacedJustified: false,
    uncovered: false,
    notes: "Bridge: cambio/reinicio empresa → company.list(reset)",
  },
  {
    function: "enrichPlanForCompanyCapture",
    module: "commander-v3/enrich/company-capture.ts",
    reusedInNext: true,
    replacedJustified: false,
    uncovered: false,
    notes: "Bridge: índice/nombre → company.select",
  },
  {
    function: "attachParkedOpsAfterCompanySelect",
    module: "commander-v3/enrich/company-capture.ts",
    reusedInNext: true,
    replacedJustified: false,
    uncovered: false,
    notes: "Invocado vía company-capture",
  },
  {
    function: "enrichPlanForExpectedFields",
    module: "commander-v3/enrich/expected-field-capture.ts",
    reusedInNext: true,
    replacedJustified: false,
    uncovered: false,
    notes: "Bridge: unit/value/date/free_text expected",
  },
  {
    function: "enrichExpectedUnit",
    module: "commander-v3/enrich/expected-field-capture.ts",
    reusedInNext: true,
    replacedJustified: false,
    uncovered: false,
    notes: "Código/patente/índice vía expected-field",
  },
  {
    function: "enrichPlanForMeterValueFallback",
    module: "commander-v3/enrich/expected-field-capture.ts",
    reusedInNext: true,
    replacedJustified: false,
    uncovered: false,
    notes: "Bridge: valor numérico en recolección medidor",
  },
  {
    function: "enrichPlanForConfirmationOutcome",
    module: "commander-v3/enrich/confirmation-outcome.ts",
    reusedInNext: true,
    replacedJustified: false,
    uncovered: false,
    notes: "Bridge: confirmación/corrección con pendingWrite",
  },
  {
    function: "resolveUnitReference",
    module: "commander-v3/entities/resolve.ts",
    reusedInNext: true,
    replacedJustified: false,
    uncovered: false,
    notes: "Preview + execute en process-turn",
  },
  {
    function: "resolveCompanyReference",
    module: "commander-v3/entities/resolve.ts",
    reusedInNext: true,
    replacedJustified: false,
    uncovered: false,
    notes: "Execute path process-turn",
  },
  {
    function: "filterUnitsByUnitName",
    module: "pilot/unit-fleet.ts",
    reusedInNext: true,
    replacedJustified: false,
    uncovered: false,
    notes: "Vía enrichExpectedUnit + resolveUnitReference",
  },
  {
    function: "extractUnitNameCode",
    module: "pilot/unit-fleet.ts",
    reusedInNext: true,
    replacedJustified: false,
    uncovered: false,
    notes: "Vía enrichExpectedUnit",
  },
  {
    function: "enrichPlanForCompanyOpsGate",
    module: "commander-v3/enrich/company-ops-gate.ts",
    reusedInNext: false,
    replacedJustified: true,
    uncovered: false,
    notes: "Controller Next + bridge company.select",
  },
  {
    function: "enrichPlanForGreetingCompanyGate",
    module: "commander-v3/enrich/company-capture.ts",
    reusedInNext: false,
    replacedJustified: true,
    uncovered: false,
    notes: "Controller greeting-policy",
  },
  {
    function: "enrichPlanForGreetingPolicy",
    module: "commander-v3/enrich/greeting-policy.ts",
    reusedInNext: false,
    replacedJustified: true,
    uncovered: false,
    notes: "Controller decideTurn saludo",
  },
  {
    function: "enrichPlanForQuestionContract",
    module: "commander-v3/enrich/question-contract.ts",
    reusedInNext: false,
    replacedJustified: true,
    uncovered: false,
    notes: "Controller lateral/ambigüedad",
  },
  {
    function: "enrichPlanForOpenTaskHold",
    module: "commander-v3/enrich/open-task-hold.ts",
    reusedInNext: false,
    replacedJustified: true,
    uncovered: false,
    notes: "Controller keep_or_close / explicit-change",
  },
  {
    function: "enrichPlanForKeepOrCloseAnswer",
    module: "commander-v3/enrich/open-task-hold.ts",
    reusedInNext: false,
    replacedJustified: true,
    uncovered: false,
    notes: "Controller keep_or_close purpose",
  },
  {
    function: "enrichPlanForTaskSwitch",
    module: "commander-v3/enrich/task-switch.ts",
    reusedInNext: false,
    replacedJustified: true,
    uncovered: false,
    notes: "Controller isExplicitTaskChange",
  },
  {
    function: "enrichPlanForGpsUnitInMessage",
    module: "commander-v3/enrich/gps-unit-from-message.ts",
    reusedInNext: false,
    replacedJustified: false,
    uncovered: true,
    notes: "Pendiente: GPS con patente en mensaje sin expected",
  },
  {
    function: "enrichPlanForFleetSearchQuery",
    module: "commander-v3/enrich/gps-unit-from-message.ts",
    reusedInNext: false,
    replacedJustified: false,
    uncovered: true,
    notes: "Pendiente: consulta flota con query",
  },
  {
    function: "enrichPlanForMeterUnitInMessage",
    module: "commander-v3/enrich/meter-unit-from-message.ts",
    reusedInNext: false,
    replacedJustified: false,
    uncovered: true,
    notes: "Pendiente: unidad en mensaje de medidor sin expected",
  },
  {
    function: "enrichPlanStripBareFleetDump",
    module: "commander-v3/enrich/bare-fleet-dump.ts",
    reusedInNext: false,
    replacedJustified: true,
    uncovered: false,
    notes: "process-turn filtra unit.search vacío",
  },
  {
    function: "enrichPlanForOpenConsult",
    module: "commander-v3/enrich/open-consult.ts",
    reusedInNext: false,
    replacedJustified: false,
    uncovered: true,
    notes: "Pendiente: consultas abiertas dominio",
  },
  {
    function: "enrichPlanForPendingConfirmSwitch",
    module: "commander-v3/enrich/pending-confirm-switch.ts",
    reusedInNext: false,
    replacedJustified: true,
    uncovered: false,
    notes: "confirmation-guard Next",
  },
  {
    function: "enrichPlanForCancelGuard",
    module: "commander-v3/enrich/cancel-guard.ts",
    reusedInNext: false,
    replacedJustified: true,
    uncovered: false,
    notes: "Controller cancel",
  },
  {
    function: "enrichPlanForConversationClose",
    module: "commander-v3/enrich/conversation-close.ts",
    reusedInNext: false,
    replacedJustified: true,
    uncovered: false,
    notes: "Controller cancel/close",
  },
  {
    function: "enrichPlanForSoftClose",
    module: "commander-v3/enrich/soft-close.ts",
    reusedInNext: false,
    replacedJustified: false,
    uncovered: true,
    notes: "Pendiente: despedida suave",
  },
  {
    function: "enrichPlanForIdlePendingConfirm",
    module: "commander-v3/enrich/idle-pending-confirm.ts",
    reusedInNext: false,
    replacedJustified: false,
    uncovered: true,
    notes: "Pendiente: idle con confirm pendiente",
  },
  {
    function: "enrichPlanWithNaturalDatetime",
    module: "commander-v3/enrich/natural-datetime-plan.ts",
    reusedInNext: true,
    replacedJustified: false,
    uncovered: false,
    notes: "process-turn post-bridge",
  },
];

export function parityMatrixSummary(): {
  reused: number;
  replaced: number;
  uncovered: number;
  uncoveredFunctions: string[];
} {
  const uncovered = OPERATIONAL_PARITY_MATRIX.filter((r) => r.uncovered);
  return {
    reused: OPERATIONAL_PARITY_MATRIX.filter((r) => r.reusedInNext).length,
    replaced: OPERATIONAL_PARITY_MATRIX.filter((r) => r.replacedJustified && !r.reusedInNext).length,
    uncovered: uncovered.length,
    uncoveredFunctions: uncovered.map((r) => r.function),
  };
}
