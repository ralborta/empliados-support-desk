export const V1_PRESENCE_TIMEOUT_MS = 2 * 60 * 1000;
export const V1_DISCONNECT_GRACE_MS = 5 * 60 * 1000;
export type QueuePriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";
export type AdvisorCandidate = Readonly<{ id: string; teamId: string; available: boolean; presentSince: string; activeConversationCount: number }>;
export type AssignmentRequest = Readonly<{ teamId: string; priority: QueuePriority; currentAdvisorId?: string | null }>;
export type AssignmentSelection = Readonly<{ status: "selected"; advisorId: string; reason: "already_assigned" | "least_loaded" }> | Readonly<{ status: "unavailable"; reason: "no_available_advisor" }>;
export interface AssignmentStrategy { select(request: AssignmentRequest, candidates: readonly AdvisorCandidate[]): AssignmentSelection; }

export class V1LeastLoadAssignmentStrategy implements AssignmentStrategy {
  select(request: AssignmentRequest, candidates: readonly AdvisorCandidate[]): AssignmentSelection {
    const eligible = candidates.filter((candidate) => candidate.teamId === request.teamId && candidate.available);
    if (request.currentAdvisorId && eligible.some((candidate) => candidate.id === request.currentAdvisorId)) return { status: "selected", advisorId: request.currentAdvisorId, reason: "already_assigned" };
    if (!eligible.length) return { status: "unavailable", reason: "no_available_advisor" };
    const [selected] = [...eligible].sort((a, b) => a.activeConversationCount - b.activeConversationCount || a.presentSince.localeCompare(b.presentSince) || a.id.localeCompare(b.id));
    return { status: "selected", advisorId: selected!.id, reason: "least_loaded" };
  }
}
