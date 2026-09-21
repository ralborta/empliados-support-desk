import type { ConversationOperationsAdapter, ConversationMutationInput, ConversationOperationData, TicketMutationInput, TicketOperationData, TicketOperationsAdapter } from "./operational-service-contracts.js";
import type { NormalizedServiceResult } from "./normalized-service-result.js";

type ConversationAction = "handoff" | "assign" | "release";
type TicketAction = "create" | "update" | "close" | "reopen";

export class FakeConversationOperationsAdapter implements ConversationOperationsAdapter {
  readonly effects: Array<{ action: ConversationAction; input: ConversationMutationInput }> = [];
  private readonly completed = new Map<string, NormalizedServiceResult<ConversationOperationData>>();
  constructor(private readonly responses: Partial<Record<ConversationAction, NormalizedServiceResult<ConversationOperationData>>>) {}
  handoff(input: ConversationMutationInput) { return this.execute("handoff", input); }
  assign(input: ConversationMutationInput) { return this.execute("assign", input); }
  release(input: ConversationMutationInput) { return this.execute("release", input); }
  private async execute(action: ConversationAction, input: ConversationMutationInput): Promise<NormalizedServiceResult<ConversationOperationData>> {
    const key = `${action}:${input.idempotencyKey}`;
    const duplicate = this.completed.get(key);
    if (duplicate) return duplicate;
    const result = this.responses[action] ?? { status: "backend_error", safeError: "fake_response_missing" };
    this.effects.push({ action, input });
    this.completed.set(key, result);
    return result;
  }
}

export class FakeTicketOperationsAdapter implements TicketOperationsAdapter {
  readonly effects: Array<{ action: TicketAction; input: TicketMutationInput }> = [];
  private readonly completed = new Map<string, NormalizedServiceResult<TicketOperationData>>();
  constructor(private readonly responses: Partial<Record<TicketAction | "get_status", NormalizedServiceResult<TicketOperationData>>>) {}
  create(input: TicketMutationInput) { return this.execute("create", input); }
  update(input: TicketMutationInput) { return this.execute("update", input); }
  close(input: TicketMutationInput) { return this.execute("close", input); }
  reopen(input: TicketMutationInput) { return this.execute("reopen", input); }
  async getStatus(input: Readonly<{ ticketId: string }>): Promise<NormalizedServiceResult<TicketOperationData>> {
    return this.responses.get_status ?? { status: "backend_error", safeError: "fake_response_missing" };
  }
  private async execute(action: TicketAction, input: TicketMutationInput): Promise<NormalizedServiceResult<TicketOperationData>> {
    const key = `${action}:${input.idempotencyKey}`;
    const duplicate = this.completed.get(key);
    if (duplicate) return duplicate;
    const result = this.responses[action] ?? { status: "backend_error", safeError: "fake_response_missing" };
    this.effects.push({ action, input });
    this.completed.set(key, result);
    return result;
  }
}
