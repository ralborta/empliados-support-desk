export type CleanLiveCase = Readonly<{ id: string; category: "interpretation" | "continuity" | "lateral" | "switch" | "correction" | "reference" | "naturalness"; message: string; context?: "previous_unit" | "without_previous_unit" }>;
export const CLEAN_LIVE_SYNTHETIC_CORPUS: readonly CleanLiveCase[] = Object.freeze([
  { id: "interpret-odometer", category: "interpretation", message: "Quiero informar el kilometraje de una unidad." },
  { id: "continuity-value", category: "continuity", message: "El valor es 128450." },
  { id: "lateral-company", category: "lateral", message: "Antes, ¿con qué empresa estoy operando?" },
  { id: "switch-certificate", category: "switch", message: "Dejemos eso en pausa y necesito un certificado." },
  { id: "correction-date", category: "correction", message: "Corrijo la fecha: corresponde a ayer." },
  { id: "reference-unit-with-context", category: "reference", message: "Usá la unidad anterior.", context: "previous_unit" },
  { id: "reference-unit-without-context", category: "reference", message: "Usá la unidad anterior.", context: "without_previous_unit" },
  { id: "natural-confirmation", category: "naturalness", message: "Sí, confirmo esa operación." },
]);
