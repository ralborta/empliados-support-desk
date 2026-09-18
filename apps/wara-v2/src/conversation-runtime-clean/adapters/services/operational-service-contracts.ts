import type { NormalizedServiceResult } from "./normalized-service-result.js";

export type CommitBinding = Readonly<{ operationId: string; version: number; payloadHash: string; idempotencyKey: string }>;
export type ConversationDestination = Readonly<{ type: "agent" | "team" | "queue"; id: string }>;
export type ConversationMutationInput = CommitBinding & Readonly<{ conversationId: string; destination?: ConversationDestination; reason?: string }>;
export type TicketMutationInput = CommitBinding & Readonly<{ ticketId?: string; subject?: string; detail?: string; category?: string; priority?: string; responsibleId?: string }>;
export type ConversationOperationData = Readonly<{ conversationId: string; assignedTo?: string; state: "handed_off" | "assigned" | "released" }>;
export type TicketOperationData = Readonly<{ ticketId: string; reference?: string; status: "open" | "in_progress" | "waiting_customer" | "resolved" | "closed" }>;

export interface ConversationOperationsAdapter {
  handoff(input: ConversationMutationInput): Promise<NormalizedServiceResult<ConversationOperationData>>;
  assign(input: ConversationMutationInput): Promise<NormalizedServiceResult<ConversationOperationData>>;
  release(input: ConversationMutationInput): Promise<NormalizedServiceResult<ConversationOperationData>>;
}
export interface TicketOperationsAdapter {
  create(input: TicketMutationInput): Promise<NormalizedServiceResult<TicketOperationData>>;
  getStatus(input: Readonly<{ ticketId: string }>): Promise<NormalizedServiceResult<TicketOperationData>>;
  update(input: TicketMutationInput): Promise<NormalizedServiceResult<TicketOperationData>>;
  close(input: TicketMutationInput): Promise<NormalizedServiceResult<TicketOperationData>>;
  reopen(input: TicketMutationInput): Promise<NormalizedServiceResult<TicketOperationData>>;
}
