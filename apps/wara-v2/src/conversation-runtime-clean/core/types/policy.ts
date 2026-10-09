import type { TurnDecision } from "./decision.js";
import type { TurnInterpretation } from "./interpretation.js";
import type { ConversationStateClean, ExpectedInputDraft } from "./state.js";
export type PolicyViolation = Readonly<{ code: string; message: string; severity: "warning" | "blocking" }>;
export type PolicyResult =
  | Readonly<{ outcome: "allow"; violations: readonly [] }>
  | Readonly<{ outcome: "block"; violations: readonly PolicyViolation[] }>
  | Readonly<{ outcome: "clarify"; reason: string; expected: ExpectedInputDraft; violations: readonly PolicyViolation[] }>;
export type PolicyInput = Readonly<{
  interpretation: TurnInterpretation;
  decision: TurnDecision;
  state: ConversationStateClean;
  turn: Readonly<{ messageId?: string }>;
}>;
