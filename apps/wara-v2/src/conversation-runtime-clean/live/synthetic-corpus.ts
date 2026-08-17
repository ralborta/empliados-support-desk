export type CleanLiveCase = Readonly<{
  id: string;
  category: "interpretation" | "continuity" | "lateral" | "switch" | "correction" | "reference" | "naturalness" | "temporal" | "cancellation" | "unit_search" | "status" | "company_selection";
  message: string;
  context?: "previous_unit" | "without_previous_unit" | "expected_date" | "expected_unit" | "expected_value" | "expected_company" | "pending_hourmeter";
}>;
export const CLEAN_LIVE_SYNTHETIC_CORPUS: readonly CleanLiveCase[] = Object.freeze([
  { id: "interpret-odometer", category: "interpretation", message: "Quiero informar el kilometraje de una unidad." },
  { id: "continuity-value", category: "continuity", message: "El valor es 128450." },
  { id: "lateral-company", category: "lateral", message: "Antes, ¿con qué empresa estoy operando?" },
  { id: "switch-certificate", category: "switch", message: "Dejemos eso en pausa y necesito un certificado." },
  { id: "correction-date", category: "correction", message: "Corrijo la fecha: corresponde a ayer." },
  { id: "reference-unit-with-context", category: "reference", message: "Usá la unidad anterior.", context: "previous_unit" },
  { id: "reference-unit-without-context", category: "reference", message: "Usá la unidad anterior.", context: "without_previous_unit" },
  { id: "natural-confirmation", category: "naturalness", message: "Sí, confirmo esa operación." },
  { id: "temporal-morning-combined", category: "temporal", message: "Hoy a las 6 de la mañana.", context: "expected_date" },
  { id: "temporal-afternoon-combined", category: "temporal", message: "Hoy a las 6 de la tarde.", context: "expected_date" },
  { id: "temporal-yesterday", category: "temporal", message: "Ayer a las 14:30.", context: "expected_date" },
  { id: "temporal-last-thursday", category: "temporal", message: "El jueves pasado a las 9.", context: "expected_date" },
  { id: "temporal-bare-monday", category: "temporal", message: "El lunes a las 8 de la mañana.", context: "expected_date" },
  { id: "temporal-ambiguous-six", category: "temporal", message: "A las 6 en punto.", context: "expected_date" },
  { id: "temporal-coloquial-afternoon", category: "temporal", message: "4 de la tarde.", context: "expected_date" },
  { id: "temporal-en-punto-noon", category: "temporal", message: "12 en punto.", context: "expected_date" },
  { id: "temporal-yesterday-clock", category: "temporal", message: "Ayer 11:00.", context: "expected_date" },
  { id: "hourmeter-combined-reading", category: "continuity", message: "71 hr ayer 11:00.", context: "expected_value" },
  { id: "cancel-pending-hourmeter", category: "cancellation", message: "No quiero hacerlo, cancelalo.", context: "pending_hourmeter" },
  { id: "change-unit-pending-hourmeter", category: "correction", message: "Mejor hacelo para la unidad 900115.", context: "pending_hourmeter" },
  { id: "unit-code-report", category: "status", message: "Quiero el estado y la posición de la unidad 900115." },
  { id: "company-answer", category: "company_selection", message: "El Cacique S.A.", context: "expected_company" },
  { id: "hourmeter-value-answer", category: "continuity", message: "120 horas.", context: "expected_value" },
  { id: "unit-code-expected", category: "unit_search", message: "900110", context: "expected_unit" },
  { id: "unit-brand-search", category: "unit_search", message: "Buscá las unidades marca Iveco." },
  { id: "unit-model-search", category: "unit_search", message: "Buscá las unidades modelo Tector." },
]);
