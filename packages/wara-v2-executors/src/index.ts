/**
 * Executors V2 — stubs Fase 4 (sin mutaciones externas).
 * dry_run: sin WARA/Odoo HTTP.
 */
import type { ExecutorResult } from "@wara-v2/contracts";

export const PHASE = 4 as const;
export const EXECUTORS_STUB = true as const;
export const ALLOW_EXTERNAL_MUTATIONS = false as const;

export function dryRunDenied(tool: string): ExecutorResult {
  return {
    status: "denied",
    data: { tool, reason: "fase4_stub_dry_run" },
    missing_fields: [],
    warnings: ["Executors stub: sin mutaciones externas"],
    error: {
      code: "MUTATIONS_DISABLED",
      message: "WARA/Odoo mutations disabled (Phase 4)",
    },
  };
}
