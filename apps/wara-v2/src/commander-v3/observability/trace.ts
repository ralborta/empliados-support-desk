import type { ConversationStateV3 } from "../types/state.js";
import type { TurnPlan } from "../types/turn-plan.js";
import type { ToolResult } from "../execute/run-capabilities.js";

export type TurnTraceV3 = {
  messageId: string;
  stateBefore: ConversationStateV3;
  commanderCalled: boolean;
  commanderRawOutput: unknown;
  turnPlan: TurnPlan | null;
  validation: { ok: boolean; errors: string[] };
  repairCalled: boolean;
  repairResult: unknown;
  entityResolution: Record<string, unknown>;
  capabilitiesRequested: Array<{ name: string; params?: Record<string, unknown> }>;
  capabilitiesExecuted: string[];
  toolResults: ToolResult[];
  statePatch: Record<string, unknown>;
  stateAfter: ConversationStateV3;
  responseFacts: string[];
  finalReply: string;
  writeAttempt: boolean;
  writeExecuted: boolean;
  latency: {
    commanderMs: number;
    repairMs: number;
    redactMs: number;
    totalMs: number;
  };
  promptVersion: string;
  model: string;
  at: string;
};
