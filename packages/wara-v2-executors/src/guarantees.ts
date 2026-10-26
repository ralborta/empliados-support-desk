/** Garantías Fase 5 — efectos reales imposibilitados. */
import { V2_MUTATIONS_DISABLED, V2_DEFAULT_MODE } from "@wara-v2/db";
import {
  MODEL_CANNOT_ORDER_COMMIT,
  PG_SOLE_LOCK_AUTHORITY,
} from "@wara-v2/contracts";

export const PHASE = 5 as const;
export const EXECUTORS_STUB = false as const;
/** Mutaciones hacia servicios reales siempre off. */
export const ALLOW_EXTERNAL_MUTATIONS = false as const;
/** Solo simulador local explícito puede recibir HTTP de prueba. */
export const ALLOW_LOCAL_SIMULATOR_ONLY = true as const;

export const GUARANTEES = {
  MODEL_CANNOT_ORDER_COMMIT,
  PG_SOLE_LOCK_AUTHORITY,
  V2_MUTATIONS_DISABLED,
  V2_DEFAULT_MODE,
  ALLOW_EXTERNAL_MUTATIONS,
  ALLOW_LOCAL_SIMULATOR_ONLY,
  /** Efectos hacia destinos reales siempre denegados. */
  allowExternalEffectReal: false as const,
} as const;

export function assertPhase5Guarantees(): void {
  if (GUARANTEES.V2_MUTATIONS_DISABLED !== true) {
    throw new Error("V2_MUTATIONS_DISABLED must be true");
  }
  if (GUARANTEES.ALLOW_EXTERNAL_MUTATIONS !== false) {
    throw new Error("ALLOW_EXTERNAL_MUTATIONS must be false");
  }
  if (GUARANTEES.allowExternalEffectReal !== false) {
    throw new Error("allowExternalEffectReal must be false");
  }
}
