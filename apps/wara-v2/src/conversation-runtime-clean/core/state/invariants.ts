import type { ConversationStateClean } from "../types/state.js";
export type StateInvariantViolation = Readonly<{ code: string; message: string }>;

export function validateStateInvariants(state: ConversationStateClean, expectedScope?: Readonly<{ tenantId: string; conversationId: string }>): readonly StateInvariantViolation[] {
  const violations: StateInvariantViolation[] = [];
  if (expectedScope && state.tenantId !== expectedScope.tenantId) violations.push({ code: "TENANT_SCOPE_MISMATCH", message: "El estado no pertenece al tenant del turno." });
  if (expectedScope && state.conversationId !== expectedScope.conversationId) violations.push({ code: "CONVERSATION_SCOPE_MISMATCH", message: "El estado no pertenece a la conversación del turno." });
  const taskIds = new Set<string>();
  for (const task of state.tasks) {
    if (!task.id) violations.push({ code: "EMPTY_TASK_ID", message: "Toda tarea debe tener identidad." });
    else if (taskIds.has(task.id)) violations.push({ code: "DUPLICATE_TASK_ID", message: "Los IDs de tarea deben ser únicos." });
    taskIds.add(task.id);
  }
  const dominant = [state.expectedInput, state.pendingResolution, state.pendingClarification,
    state.pendingOperation?.status === "awaiting_confirmation" ? state.pendingOperation : null].filter(Boolean);
  if (dominant.length > 1) violations.push({ code: "EXPECTATION_XOR", message: "Solo puede existir una expectativa dominante." });
  const activeTasks = new Map(state.tasks.filter((task) => task.status !== "completed" && task.status !== "cancelled").map((task) => [task.id, task]));
  if (state.focusedTaskId && !activeTasks.has(state.focusedTaskId)) violations.push({ code: "INVALID_FOCUSED_TASK", message: "focusedTaskId no referencia una tarea activa." });
  if (state.expectedInput?.taskId && !activeTasks.has(state.expectedInput.taskId)) violations.push({ code: "INVALID_EXPECTED_TASK", message: "expectedInput referencia una tarea inválida." });
  if (state.pendingResolution?.taskId && !activeTasks.has(state.pendingResolution.taskId)) violations.push({ code: "INVALID_RESOLUTION_TASK", message: "pendingResolution referencia una tarea inválida." });
  if (state.pendingClarification?.taskId && !activeTasks.has(state.pendingClarification.taskId)) violations.push({ code: "INVALID_CLARIFICATION_TASK", message: "pendingClarification referencia una tarea inválida." });
  if (state.pendingOperation) {
    const task = state.tasks.find((candidate) => candidate.id === state.pendingOperation!.taskId);
    if (!task || task.status !== "awaiting_confirmation") violations.push({ code: "INVALID_OPERATION_TASK", message: "pendingOperation requiere una tarea awaiting_confirmation." });
    if (!state.pendingOperation.operationId || state.pendingOperation.version <= 0 || !state.pendingOperation.payloadHash || !state.pendingOperation.idempotencyKey || !state.pendingOperation.capability) {
      violations.push({ code: "INVALID_PENDING_OPERATION", message: "pendingOperation no contiene binding completo." });
    }
  }
  if (state.company && state.unit && state.unit.companyId !== state.company.id) violations.push({ code: "UNIT_COMPANY_MISMATCH", message: "La unidad activa no pertenece a la empresa activa." });
  return violations;
}
