/**
 * Stub Fase 1 — executors (prepare/commit + MutationGuard en fases posteriores).
 * dry_run: sin mutaciones WARA/Odoo.
 */
import type { ExecutorResult } from "@wara-v2/contracts";

export const PHASE = 1 as const;
export const EXECUTORS_STUB = true as const;
export const ALLOW_EXTERNAL_MUTATIONS = false as const;

export function dryRunDenied(tool: string): ExecutorResult {
  return {
    status: "denied",
    data: { tool, reason: "fase1_stub_dry_run" },
    missing_fields: [],
    warnings: ["Executors stub: sin mutaciones externas"],
    error: {
      code: "MUTATIONS_DISABLED",
      message: "WARA/Odoo mutations disabled in Phase 1 scaffold",
    },
  };
}
