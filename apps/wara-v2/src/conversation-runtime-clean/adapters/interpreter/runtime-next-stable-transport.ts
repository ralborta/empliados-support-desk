import type { ConversationStateClean } from "../../core/types/state.js";
import type { StableInterpreterTransport } from "./stable-interpreter-adapter.js";

type HistoricalCall = (input: { message: string; state: unknown; env: NodeJS.ProcessEnv; lastAssistantReply?: string | null }) => Promise<unknown>;
export class RuntimeNextStableTransport implements StableInterpreterTransport {
  constructor(private readonly env: NodeJS.ProcessEnv) {}
  async call(input: { message: string; state: ConversationStateClean }): Promise<unknown> {
    const modulePath: string = "../../../conversation-runtime-next/interpreter/call.js";
    const historical = await import(modulePath) as { callInterpreter?: HistoricalCall };
    if (!historical.callInterpreter) throw new Error("stable_interpreter_unavailable");
    const focused = input.state.tasks.find((task) => task.id === input.state.focusedTaskId) ?? null;
    const historicalState = {
      company: input.state.company ? { id: input.state.company.id, name: input.state.company.name } : null,
      unit: input.state.unit ? { movilId: input.state.unit.id, label: input.state.unit.label, plate: input.state.unit.plate ?? null, name: input.state.unit.code ?? null } : null,
      activeTask: focused ? { type: focused.type, status: focused.status, missing: [] } : null,
      lastQuestion: input.state.expectedInput ? { purpose: input.state.expectedInput.purpose, expected: input.state.expectedInput.field } : null,
      pendingWrite: input.state.pendingOperation ? { task: focused?.type ?? "unknown", operationId: input.state.pendingOperation.operationId } : null,
      conversationMetadata: { parkedTurn: null }, recentTurns: [],
    };
    return historical.callInterpreter({ message: input.message, state: historicalState, env: this.env, lastAssistantReply: null });
  }
}
