export type UserAct =
  | "greeting" | "request" | "answer" | "question" | "correction"
  | "confirmation" | "cancellation" | "rejection" | "acknowledgement" | "unknown";

export type ThreadRelation =
  | "standalone" | "answer_expected" | "continue" | "side_question" | "switch"
  | "pause" | "resume" | "replace" | "cancel" | "confirm" | "ambiguous";

export type OperationKind = "conversation" | "read" | "write_prepare" | "write_commit" | "handoff";
export type TaskType =
  | "company" | "unit_query" | "gps" | "odometer" | "hourmeter"
  | "maintenance" | "certificate" | "knowledge" | "human_handoff"
  | "conversation_assignment" | "ticket" | "attachment";
export type EntityType = "company" | "unit" | "date" | "time" | "numeric_value" | "listing_index" | "confirmation";
export type ExpectedField = "company" | "unit" | "value" | "date" | "time" | "confirmation" | "clarification" | "free_text";

export type IntentRequest = Readonly<{
  serviceId: string;
  domain: TaskType | "conversation";
  goal: string;
  operationKind: OperationKind;
  entities: Readonly<Record<string, unknown>>;
}>;
export type EntityReference = Readonly<{
  type: EntityType;
  expression: string;
  source: "message" | "active" | "previous" | "last_presented" | "explicit";
  index?: number;
}>;
export type SuppliedField = Readonly<{ field: ExpectedField; value: unknown }>;
export type Correction = Readonly<{ field: string; value: unknown }>;
export type ConfirmationIntent = Readonly<{ intended: boolean; containsCorrections: boolean }>;
export type Ambiguity = Readonly<{ reason: string; alternatives: readonly string[]; clarificationQuestion: string }>;

export type TurnInterpretation = Readonly<{
  userAct: UserAct;
  relation: ThreadRelation;
  normalizedMeaning: string;
  intents: readonly IntentRequest[];
  references: readonly EntityReference[];
  suppliedFields: readonly SuppliedField[];
  corrections: readonly Correction[];
  answersExpectedField: boolean;
  confirmation?: ConfirmationIntent;
  ambiguity?: Ambiguity;
  confidence: number;
}>;
