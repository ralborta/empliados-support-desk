export type TicketLifecycleStatus = "open" | "in_progress" | "waiting_customer" | "resolved" | "closed";
export type TicketCreationDecision =
  | Readonly<{ outcome: "reuse"; ticketId: string }>
  | Readonly<{ outcome: "create"; linkedTicketId: string | null }>
  | Readonly<{ outcome: "conflict"; reason: "potential_duplicate" | "terminal_followup_policy_required" }>;

export function decideTicketCreation(input: { idempotencyKey: string; priorByIdempotency: Readonly<{ ticketId: string }> | null; potentialMatch: Readonly<{ ticketId: string; status: TicketLifecycleStatus }> | null; explicitReopen: boolean; allowLinkedFollowup: boolean }): TicketCreationDecision {
  if (input.priorByIdempotency) return { outcome: "reuse", ticketId: input.priorByIdempotency.ticketId };
  if (!input.potentialMatch) return { outcome: "create", linkedTicketId: null };
  if (input.potentialMatch.status === "resolved" || input.potentialMatch.status === "closed") {
    if (input.explicitReopen) return { outcome: "reuse", ticketId: input.potentialMatch.ticketId };
    if (input.allowLinkedFollowup) return { outcome: "create", linkedTicketId: input.potentialMatch.ticketId };
    return { outcome: "conflict", reason: "terminal_followup_policy_required" };
  }
  return { outcome: "conflict", reason: "potential_duplicate" };
}
