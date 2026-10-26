import type { ExecutorResult, ExecutableToolName } from "@wara-v2/contracts";
import { ALLOW_EXTERNAL_MUTATIONS } from "@wara-v2/executors";

/**
 * Stub de tools Fase 4: sin HTTP. prepare → simulated; commit → denied.
 */
export function executeStubTool(
  toolName: ExecutableToolName | string,
  args: Record<string, unknown>,
): ExecutorResult {
  void ALLOW_EXTERNAL_MUTATIONS;
  if (String(toolName).startsWith("commit_")) {
    return {
      status: "denied",
      data: { tool: toolName, args, phase: 4 },
      missing_fields: [],
      warnings: ["commit blocked: V2_MUTATIONS_DISABLED / stub executor"],
      error: {
        code: "MUTATIONS_DISABLED",
        message: "External commit denied in Phase 4 stub",
      },
    };
  }
  if (String(toolName).startsWith("prepare_")) {
    const missing: string[] = [];
    if (!args.company_id) missing.push("company_id");
    if (!args.unit_id && toolName !== "prepare_odoo_ticket") missing.push("unit_id");
    if (toolName === "prepare_odometer_update" && args.value == null && args.value_number == null) {
      missing.push("value");
    }
    if (missing.length) {
      return {
        status: "needs_data",
        data: { tool: toolName },
        missing_fields: missing,
        warnings: [],
        error: null,
      };
    }
    return {
      status: "needs_confirmation",
      data: {
        tool: toolName,
        prepared: true,
        payload: args,
      },
      missing_fields: [],
      warnings: ["dry_run_prepare_only"],
      error: null,
      operation: {
        id: "pending",
        type: toolName.replace("prepare_", ""),
        payload: args,
      },
    };
  }
  return {
    status: "simulated",
    data: { tool: toolName, args, simulated: true },
    missing_fields: [],
    warnings: ["stub_read_or_local_tool"],
    error: null,
  };
}

/** Detector de fugas: cualquier URL/fetch intento. */
export function assertNoExternalSideEffects(meta: Record<string, unknown>): void {
  const banned = ["httpUrl", "fetch", "axios", "waraBaseUrl", "odooUrl", "whatsappToken"];
  for (const k of banned) {
    if (k in meta && meta[k]) {
      throw new Error(`accidental_external_effect:${k}`);
    }
  }
}
