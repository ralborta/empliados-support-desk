import type { ResponseIntent } from "./decision.js";
import type { ConversationStateClean } from "./state.js";
export type OperationalFact = Readonly<{ code: string; source: "policy" | "resolver" | "capability" | "state"; text: string; verified: boolean }>;
export type ResponsePlan = Readonly<{ purpose: ResponseIntent["purpose"]; facts: readonly OperationalFact[]; nextQuestion: string | null; pendingTaskReminder: string | null; protectedBlocks: readonly string[] }>;
export type ComposerInput = Readonly<{ responsePlan: ResponsePlan; state: ConversationStateClean; customerName?: string | null }>;
