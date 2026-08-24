/**
 * Decisión estructurada del turno de consulta de unidad (GPS/estado vs síntoma).
 *
 * Autoridad única: UtteranceAction tipada (unit_status_read, …).
 * Contexto de unidad: solo estado persistido (activeUnit / notebook.unitFocus / trámite),
 * nunca relectura de texto del hilo.
 *
 * Frases de aceptación ("misma unidad", "cómo ves") viven en tests y en el prompt del
 * intérprete; acá no hay matchers.
 */
import type { UtteranceAction, UnitRefKind } from "@/lib/utteranceUnderstanding";

export type UnitConsultMode = "ask_unit" | "telemetry" | "listen_symptom" | "resolve";

export type UnitConsultDecisionInput = {
  utteranceAction: UtteranceAction | null | undefined;
  unitRefKind: UnitRefKind | null | undefined;
  /** Patente/código/prefijo usable en el mensaje actual (extractor de entidad, no hilo). */
  hasUsableUnitInMessage: boolean;
  /** Unidad en estado persistido (activeUnit / unitFocus / pending de trámite). */
  hasPersistedContextUnit: boolean;
  /**
   * El resolver conversacional propondría menú de síntomas.
   * Solo aplica si la acción NO es unit_status_read.
   */
  listenCandidate: boolean;
};

/**
 * Prioridad:
 * 1) unit_status_read → telemetría (limpia expectativa residual de síntomas al no escuchar).
 * 2) Sin unidad en mensaje ni estado persistido → ask_unit.
 * 3) listenCandidate solo sin unit_status_read.
 * 4) Resto → resolve.
 */
export function decideUnitConsultMode(input: UnitConsultDecisionInput): UnitConsultMode {
  const action = input.utteranceAction ?? "none";

  if (action === "unit_status_read") {
    if (!input.hasUsableUnitInMessage && !input.hasPersistedContextUnit) {
      return "ask_unit";
    }
    return "telemetry";
  }

  if (input.listenCandidate) {
    return "listen_symptom";
  }

  return "resolve";
}

/**
 * Reusar unidad persistida: unit_ref.none + acción de continuidad/estado.
 */
export function canReuseContextUnitForTurn(input: {
  utteranceAction: UtteranceAction | null | undefined;
  unitRefKind: UnitRefKind | null | undefined;
  hasUsableUnitInMessage: boolean;
  hasPersistedContextUnit: boolean;
}): boolean {
  if (!input.hasPersistedContextUnit || input.hasUsableUnitInMessage) return false;
  const kind = input.unitRefKind ?? "none";
  if (kind !== "none") return false;
  const action = input.utteranceAction ?? "none";
  return (
    action === "unit_status_read" ||
    action === "continue_field" ||
    action === "unit_reference"
  );
}

/**
 * ¿La acción estructurada es lectura de estado?
 * Única palanca para saltar menú de síntomas — no hay flag paralelo.
 */
export function isUnitStatusReadAction(
  utteranceAction: UtteranceAction | null | undefined,
): boolean {
  return utteranceAction === "unit_status_read";
}
