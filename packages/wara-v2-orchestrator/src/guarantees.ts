/** Garantías efectivas Fase 4 — no negociables. */
import {
  MODEL_CANNOT_ORDER_COMMIT,
  PG_SOLE_LOCK_AUTHORITY,
  V2_DEFAULTS,
} from "@wara-v2/contracts";
import { V2_DEFAULT_MODE, V2_MUTATIONS_DISABLED } from "@wara-v2/db";

export const PHASE = 4 as const;
export const ORCHESTRATOR_STUB = false as const;

export const GUARANTEES = {
  MODEL_CANNOT_ORDER_COMMIT,
  PG_SOLE_LOCK_AUTHORITY,
  V2_MUTATIONS_DISABLED,
  V2_DEFAULT_MODE,
  EXECUTION_MODE: V2_DEFAULTS.WARA_V2_EXECUTION_MODE,
} as const;

export function assertPhase4Guarantees(): void {
  if (GUARANTEES.MODEL_CANNOT_ORDER_COMMIT !== true) {
    throw new Error("MODEL_CANNOT_ORDER_COMMIT must be true");
  }
  if (GUARANTEES.PG_SOLE_LOCK_AUTHORITY !== true) {
    throw new Error("PG_SOLE_LOCK_AUTHORITY must be true");
  }
  if (GUARANTEES.V2_MUTATIONS_DISABLED !== true) {
    throw new Error("V2_MUTATIONS_DISABLED must be true");
  }
  if (GUARANTEES.V2_DEFAULT_MODE !== "dry_run") {
    throw new Error("V2_DEFAULT_MODE must be dry_run");
  }
}
