import type { OperationExecutionResult } from "../types/operation.js";
import type { OperationKind, TaskType } from "../types/interpretation.js";
export type CapabilityField = "company" | "unit" | "pendingOperation" | "value" | "date" | "time" | "detail";
export type CleanCapabilityDefinition = Readonly<{
  name: string; kind: OperationKind; task: TaskType; requiredFields: readonly CapabilityField[];
  requiresConfirmation: boolean; allowedResultTypes: readonly OperationExecutionResult["status"][]; safeErrors: readonly string[];
}>;
const RESULTS = ["success", "not_found", "invalid", "backend_error", "blocked"] as const;
function capability(name: string, kind: OperationKind, task: TaskType, requiredFields: readonly CapabilityField[], requiresConfirmation: boolean, safeErrors: readonly string[]): CleanCapabilityDefinition {
  return { name, kind, task, requiredFields, requiresConfirmation, allowedResultTypes: RESULTS, safeErrors };
}
export const CLEAN_CAPABILITY_CATALOG: readonly CleanCapabilityDefinition[] = [
  capability("company.list", "read", "company", [], false, ["no_companies"]),
  capability("company.select", "read", "company", [], false, ["not_found", "ambiguous"]),
  capability("company.get_active", "read", "company", [], false, ["no_company"]),
  capability("unit.search", "read", "unit_query", ["company"], false, ["no_company", "not_found"]),
  capability("unit.select", "read", "unit_query", [], false, ["not_found", "ambiguous"]),
  capability("unit.get_active", "read", "unit_query", [], false, ["no_unit"]),
  capability("unit.get_previous", "read", "unit_query", [], false, ["no_previous_unit"]),
  capability("gps.get_status", "read", "gps", ["unit"], false, ["no_unit", "no_data"]),
  capability("odometer.prepare", "write_prepare", "odometer", ["unit", "value", "date", "time"], true, ["missing_fields", "anomaly"]),
  capability("odometer.update", "write_commit", "odometer", ["pendingOperation"], true, ["binding_mismatch", "write_disabled"]),
  capability("hourmeter.prepare", "write_prepare", "hourmeter", ["unit", "value", "date", "time"], true, ["missing_fields", "anomaly"]),
  capability("hourmeter.update", "write_commit", "hourmeter", ["pendingOperation"], true, ["binding_mismatch", "write_disabled"]),
  capability("maintenance.prepare", "write_prepare", "maintenance", ["unit", "detail"], true, ["missing_fields"]),
  capability("maintenance.create", "write_commit", "maintenance", ["pendingOperation"], true, ["binding_mismatch", "write_disabled"]),
  capability("certificate.prepare", "write_prepare", "certificate", ["unit"], true, ["no_unit"]),
  capability("certificate.issue", "write_commit", "certificate", ["pendingOperation"], true, ["binding_mismatch", "write_disabled"]),
  capability("domain.answer", "read", "knowledge", [], false, ["unknown_topic"]),
  capability("handoff.prepare", "write_prepare", "human_handoff", ["detail"], true, ["missing_detail"]),
  capability("handoff.create", "write_commit", "human_handoff", ["pendingOperation"], true, ["binding_mismatch", "write_disabled"]),
];
export function getCleanCapability(name: string): CleanCapabilityDefinition | undefined {
  return CLEAN_CAPABILITY_CATALOG.find((definition) => definition.name === name);
}
