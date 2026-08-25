/**
 * Decisión estructurada del turno de consulta de unidad (GPS/estado vs síntoma).
 *
 * Autoridad única: UtteranceAction tipada (unit_status_read, …).
 * Frases de aceptación ("misma unidad", "cómo ves") viven en tests y en el prompt del
 * intérprete; acá no hay matchers de intención.
 *
 * Precedencia de entidad (bajo unit_status_read ya decidido):
 * 1) unit_ref estructurado y resoluble del LLM
 * 2) patente/interno/código extraído del mensaje (formato admitido)
 * 3) activeUnit
 * 4) notebook.unitFocus
 * 5) pedir unidad
 *
 * Un número solo gana sobre activeUnit cuando el dominio ya es unit_status_read
 * y el valor cumple formato de interno/patente — no es un router por regex.
 */
import type { UtteranceAction, UnitRefKind } from "@/lib/utteranceUnderstanding";
import {
  hasEmbeddedUnitInternoCandidate,
  resolveMovilIdUnderUnitStatusReadDomain,
  type FleetUnitRef,
} from "@/lib/unitReferenceParser";

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
 * Reusar unidad persistida: unit_ref.none + sin entidad resoluble en el mensaje
 * + acción de continuidad/estado. Nunca si hay referencia de mensaje (aunque falle
 * luego en flota — no caer en activeUnit en silencio).
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
 * Bajo unit_status_read: extrae interno resoluble del mensaje (parser condicionado).
 * Con otra acción → null (no interpretar el número automáticamente como unidad).
 */
export function movilIdFromMessageUnderStatusRead(params: {
  utteranceAction: UtteranceAction | null | undefined;
  rawText: string;
  fleet?: FleetUnitRef[];
}): number | null {
  if (params.utteranceAction !== "unit_status_read") return null;
  return resolveMovilIdUnderUnitStatusReadDomain(params.rawText, { fleet: params.fleet });
}

/**
 * Señal de entidad en mensaje bajo unit_status_read (bloquea reuso de contexto).
 * Incluye candidato de formato admitido aunque aún no haya match de flota.
 */
export function hasStatusReadMessageUnitEntity(params: {
  utteranceAction: UtteranceAction | null | undefined;
  rawText: string;
  /** Ya detectado por patente/prefijo/nombre/movil clásico. */
  hasUsableUnitInMessage: boolean;
}): boolean {
  if (params.hasUsableUnitInMessage) return true;
  if (params.utteranceAction !== "unit_status_read") return false;
  if (movilIdFromMessageUnderStatusRead(params) != null) return true;
  return hasEmbeddedUnitInternoCandidate(params.rawText);
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
