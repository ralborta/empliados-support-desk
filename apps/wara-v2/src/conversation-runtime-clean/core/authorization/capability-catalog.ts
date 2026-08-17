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
  capability("conversation.handoff.prepare", "write_prepare", "human_handoff", ["detail"], true, ["destination_not_found", "already_handed_off"]),
  capability("conversation.handoff.commit", "write_commit", "human_handoff", ["pendingOperation"], true, ["binding_mismatch", "write_disabled"]),
  capability("conversation.assign.prepare", "write_prepare", "conversation_assignment", ["detail"], true, ["destination_not_found", "already_assigned"]),
  capability("conversation.assign.commit", "write_commit", "conversation_assignment", ["pendingOperation"], true, ["binding_mismatch", "write_disabled"]),
  capability("conversation.release.prepare", "write_prepare", "conversation_assignment", ["detail"], true, ["already_released"]),
  capability("conversation.release.commit", "write_commit", "conversation_assignment", ["pendingOperation"], true, ["binding_mismatch", "write_disabled"]),
  capability("ticket.create.prepare", "write_prepare", "ticket", ["detail"], true, ["validation_error"]),
  capability("ticket.create.commit", "write_commit", "ticket", ["pendingOperation"], true, ["binding_mismatch", "write_disabled"]),
  capability("ticket.get_status", "read", "ticket", ["detail"], false, ["not_found", "backend_error"]),
  capability("ticket.update.prepare", "write_prepare", "ticket", ["detail"], true, ["validation_error", "not_found"]),
  capability("ticket.update.commit", "write_commit", "ticket", ["pendingOperation"], true, ["binding_mismatch", "write_disabled"]),
  capability("ticket.close.prepare", "write_prepare", "ticket", ["detail"], true, ["not_found", "already_closed"]),
  capability("ticket.close.commit", "write_commit", "ticket", ["pendingOperation"], true, ["binding_mismatch", "write_disabled"]),
  capability("ticket.reopen.prepare", "write_prepare", "ticket", ["detail"], true, ["not_found", "already_open"]),
  capability("ticket.reopen.commit", "write_commit", "ticket", ["pendingOperation"], true, ["binding_mismatch", "write_disabled"]),
  capability("attachment.prepare", "write_prepare", "attachment", ["detail"], true, ["validation_error", "unsupported_type", "size_exceeded"]),
  capability("attachment.commit", "write_commit", "attachment", ["pendingOperation"], true, ["binding_mismatch", "write_disabled"]),
  capability("attachment.get", "read", "attachment", ["detail"], false, ["not_found"]),
  capability("attachment.link_to_ticket", "write_commit", "attachment", ["pendingOperation"], true, ["not_found", "conflict", "write_disabled"]),
  capability("attachment.link_to_maintenance", "write_commit", "attachment", ["pendingOperation"], true, ["not_found", "conflict", "write_disabled"]),
];
export function getCleanCapability(name: string): CleanCapabilityDefinition | undefined {
  return CLEAN_CAPABILITY_CATALOG.find((definition) => definition.name === name);
}

const PREPARE_TO_COMMIT: Readonly<Record<string, string>> = Object.freeze({
  "odometer.prepare": "odometer.update",
  "hourmeter.prepare": "hourmeter.update",
  "maintenance.prepare": "maintenance.create",
  "certificate.prepare": "certificate.issue",
  "handoff.prepare": "handoff.create",
  "conversation.handoff.prepare": "conversation.handoff.commit",
  "conversation.assign.prepare": "conversation.assign.commit",
  "conversation.release.prepare": "conversation.release.commit",
  "ticket.create.prepare": "ticket.create.commit",
  "ticket.update.prepare": "ticket.update.commit",
  "ticket.close.prepare": "ticket.close.commit",
  "ticket.reopen.prepare": "ticket.reopen.commit",
  "attachment.prepare": "attachment.commit",
});

export function commitCapabilityForPrepare(name: string): string | null {
  return PREPARE_TO_COMMIT[name] ?? null;
}
