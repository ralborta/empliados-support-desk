import type {
  ExecutionMode,
  GoalId,
  InboundMessageNormalized,
  OrchestratorDecision,
  PolicyDecision,
  TurnOutcome,
} from "@wara-v2/contracts";
import type { OperationRecord } from "@wara-v2/domain";
import type { DeliveryGateResult } from "./delivery/types.js";

export type FeatureFlags = {
  enabled: boolean;
  allowedGoals: GoalId[];
  allowWhatsAppSend: boolean;
  allowWaraMutations: boolean;
  allowOdooMutations: boolean;
};

export const DEFAULT_FEATURE_FLAGS: FeatureFlags = {
  enabled: true,
  allowedGoals: [
    "none",
    "clarify",
    "list_capabilities",
    "resolve_units",
    "unit_status",
    "update_odometer",
    "issue_certificate",
    "create_maintenance",
    "odoo_ticket",
    "human_handoff",
    "bot_pause",
  ],
  allowWhatsAppSend: false,
  allowWaraMutations: false,
  allowOdooMutations: false,
};

export type ConversationSnapshot = {
  conversationId: string;
  customerId: string;
  activeCompanyId: string | null;
  activeUnitId: string | null;
  channel: InboundMessageNormalized["channel"];
  channelAccountId: string;
  membershipCompanyIds: string[];
};

export type TurnContext = {
  conversation: ConversationSnapshot;
  inbound: InboundMessageNormalized;
  activeOperations: OperationRecord[];
  pendingConfirmationOperationId: string | null;
  stateVersion: number;
  executionMode: ExecutionMode;
  featureFlags: FeatureFlags;
  now: Date;
};

export type TraceEvent = {
  at: string;
  event: string;
  meta?: Record<string, unknown>;
};

export type TurnPipelineInput = {
  commandId: string;
  inbound: InboundMessageNormalized;
  conversation: ConversationSnapshot;
  /** Operaciones activas conocidas (puerto de lectura). */
  activeOperations?: OperationRecord[];
  pendingConfirmationOperationId?: string | null;
  stateVersion?: number;
  executionMode?: ExecutionMode;
  featureFlags?: FeatureFlags;
  now?: Date;
  /** Owner del worker para ConversationLock. */
  ownerId?: string;
};

export type TurnPipelineResult = {
  turnId: string;
  outcome: TurnOutcome;
  commandId: string;
  idempotent: boolean;
  decision: OrchestratorDecision | null;
  policy: PolicyDecision | null;
  delivery: DeliveryGateResult | null;
  responseText: string;
  operationIds: string[];
  traces: TraceEvent[];
  rejection?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
  lock?: { fencingToken: bigint; ownerId: string } | null;
};

export type SimulatedOutbound = {
  channel: string;
  text: string;
  suppressed: true;
  reason: string;
};
