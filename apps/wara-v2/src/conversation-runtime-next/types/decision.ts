import { z } from "zod";
import type { CapabilityRequest } from "../../commander-v3/types/turn-plan.js";
import type { TaskTypeV3 } from "../../commander-v3/types/state.js";

export const DialogueActionSchema = z.enum([
  "respond",
  "clarify",
  "ask_missing",
  "confirm_write",
  "execute",
  "keep_or_close",
  "resume",
  "cancel",
]);

export type DialogueAction = z.infer<typeof DialogueActionSchema>;

export type TurnDecision = {
  action: DialogueAction;
  reasoning: string;
  authorizedCapabilities: CapabilityRequest[];
  conversationalAct: import("../../commander-v3/types/turn-plan.js").TurnPlan["conversationalAct"];
  task?: TaskTypeV3 | null;
  taskAction?: import("../../commander-v3/types/turn-plan.js").TurnPlan["taskAction"];
  suppliedFields?: import("../../commander-v3/types/turn-plan.js").TurnPlan["suppliedFields"];
  unitReference?: import("../../commander-v3/types/turn-plan.js").TurnPlan["unitReference"];
  companyReference?: import("../../commander-v3/types/turn-plan.js").TurnPlan["companyReference"];
  lateralQuestion?: import("../../commander-v3/types/turn-plan.js").TurnPlan["lateralQuestion"];
  parkedTurn?: import("../../commander-v3/types/turn-plan.js").TurnPlan["parkedTurn"];
  stateIntent: import("../../commander-v3/types/turn-plan.js").TurnPlan["stateIntent"];
  responseGoal: import("../../commander-v3/types/turn-plan.js").TurnPlan["responseGoal"];
  confidence: number;
  interpretationSummary: string;
};
