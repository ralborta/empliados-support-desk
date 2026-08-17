import type { CapabilityAuthorizer, CapabilityExecutor, ContextLoader, ConversationStore, EntityResolver, Interpreter } from "../../core/ports/ports.js";
import type { TurnDecision } from "../../core/types/decision.js";
import type { TurnInterpretation } from "../../core/types/interpretation.js";
import type { AuthorizationResult, AuthorizedOperation, OperationExecutionResult } from "../../core/types/operation.js";
import type { ResolutionResult } from "../../core/types/resolution.js";
import type { ConversationStateClean } from "../../core/types/state.js";

export class FakeContextLoader implements ContextLoader {
  constructor(public state: ConversationStateClean) {}
  async load(): Promise<ConversationStateClean> { return this.state; }
}

export class FakeInterpreter implements Interpreter {
  public calls = 0;
  constructor(private readonly outputs: readonly (TurnInterpretation | null)[]) {}
  async interpret(): Promise<TurnInterpretation | null> {
    const value = this.outputs[Math.min(this.calls, this.outputs.length - 1)] ?? null;
    this.calls += 1;
    return value;
  }
}

export class FakeEntityResolver implements EntityResolver {
  public calls = 0;
  constructor(private readonly results: readonly ResolutionResult[] = []) {}
  async resolve(): Promise<readonly ResolutionResult[]> { this.calls += 1; return this.results; }
}

export class FakeCapabilityAuthorizer implements CapabilityAuthorizer {
  authorize(input: { decision: TurnDecision; state: ConversationStateClean; resolutions: readonly ResolutionResult[] }): AuthorizationResult {
    const resolved = new Set(input.resolutions.filter((result) => result.status === "resolved").map((result) => result.requestId));
    const operations: AuthorizedOperation[] = [];
    for (const request of input.decision.requestedOperations) {
      if (request.requiredResolutionIds.some((id) => !resolved.has(id))) {
        return { outcome: "blocked", violations: [{ code: "UNRESOLVED_DEPENDENCY", message: "La operación depende de una resolución incompleta.", severity: "blocking" }] };
      }
      if (request.kind === "write_commit") {
        const pending = input.state.pendingOperation;
        if (!pending || request.capability !== pending.capability || request.arguments.operationId !== pending.operationId
          || request.arguments.version !== pending.version || request.arguments.payloadHash !== pending.payloadHash) {
          return { outcome: "blocked", violations: [{ code: "PENDING_BINDING_MISMATCH", message: "El commit no coincide con la operación preparada.", severity: "blocking" }] };
        }
      }
      operations.push({ requestId: request.id, capability: request.capability, kind: request.kind, task: request.task, arguments: request.arguments });
    }
    return { outcome: "authorized", operations };
  }
}

export class FakeCapabilityExecutor implements CapabilityExecutor {
  public calls = 0;
  public received: readonly AuthorizedOperation[] = [];
  constructor(private readonly configured: readonly OperationExecutionResult[] = []) {}
  async execute(operations: readonly AuthorizedOperation[]): Promise<readonly OperationExecutionResult[]> {
    this.calls += 1; this.received = operations;
    return this.configured.length ? this.configured : operations.map((operation) => ({
      requestId: operation.requestId, capability: operation.capability, status: "success" as const,
      facts: [], writeAttempt: false, writeExecuted: false,
    }));
  }
}

export class InMemoryConversationStore implements ConversationStore {
  public saved: ConversationStateClean[] = [];
  async save(state: ConversationStateClean): Promise<void> { this.saved.push(state); }
}
