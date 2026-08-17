import type { CapabilityRequest } from "../../commander-v3/types/turn-plan.js";
import type { ConversationStateV3 } from "../../commander-v3/types/state.js";
import type { ConversationStateVNext } from "../state/vnext-types.js";
import type { TurnDecision } from "../types/decision.js";
import type { TurnInterpretation } from "../types/interpretation.js";

export type OperationalFact = {
  kind: "info" | "warning" | "resolution";
  text: string;
  source: string;
};

export type UnresolvedStatus =
  | "not_found"
  | "ambiguous"
  | "invalid"
  | "service_error"
  | "missing_data";

export type UnresolvedRequirement = {
  field: "company" | "unit" | "value" | "date" | "time" | "confirmation" | "clarification" | "free_text";
  status: UnresolvedStatus;
  query?: string;
  detail?: string;
};

export type OperationalResolutionInput = {
  decision: TurnDecision;
  interpretation: TurnInterpretation;
  state: ConversationStateV3;
  vnext: ConversationStateVNext;
  message: string;
};

import type { ExpectedCaptureEligibility } from "./expected-input-capture-gate.js";

export type OperationalResolutionResult = {
  decision: TurnDecision;
  resolvedEntities: Record<string, unknown>;
  capabilityRequests: CapabilityRequest[];
  operationalFacts: OperationalFact[];
  unresolved: UnresolvedRequirement[];
  enrichersApplied: string[];
  expectedCapture: ExpectedCaptureEligibility;
};
