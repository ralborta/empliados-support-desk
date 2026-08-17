import { z } from "zod";

export const UserActSchema = z.enum([
  "greeting",
  "request",
  "answer",
  "question",
  "correction",
  "confirmation",
  "cancellation",
  "rejection",
  "acknowledgement",
  "unknown",
]);

export const ThreadRelationSchema = z.enum([
  "standalone",
  "answer_expected",
  "continue",
  "side_question",
  "switch",
  "pause",
  "resume",
  "replace",
  "cancel",
  "confirm",
  "ambiguous",
]);

export const InterpretedRequestSchema = z.object({
  serviceId: z.string().optional(),
  domain: z.string().optional(),
  goal: z.string().min(1).max(400),
  entities: z.record(z.string(), z.unknown()).default({}),
  operationHint: z
    .enum(["conversation", "read", "write", "handoff"])
    .optional(),
});

export const ContextualReferenceSchema = z.object({
  type: z.enum(["company", "unit", "task", "index", "entity"]),
  expression: z.string().max(200),
  source: z
    .enum([
      "active",
      "previous",
      "last_presented",
      "message",
      "none",
    ])
    .optional(),
  index: z.number().int().positive().optional(),
});

export const FieldCorrectionSchema = z.object({
  field: z.string(),
  value: z.unknown().optional(),
});

export const TurnInterpretationSchema = z.object({
  userAct: UserActSchema,
  relation: ThreadRelationSchema,
  normalizedMeaning: z.string().min(1).max(800),
  requests: z.array(InterpretedRequestSchema).default([]),
  references: z.array(ContextualReferenceSchema).default([]),
  corrections: z.array(FieldCorrectionSchema).default([]),
  answersExpectedField: z.boolean().default(false),
  expectedFieldValue: z.unknown().optional(),
  confidence: z.number().min(0).max(1),
  ambiguity: z
    .object({
      reason: z.string(),
      alternatives: z.array(z.string()),
      clarificationQuestion: z.string(),
    })
    .optional(),
  confirmation: z
    .object({
      intended: z.boolean(),
      containsCorrections: z.boolean(),
      targetOperationId: z.string().optional(),
    })
    .optional(),
});

export type UserAct = z.infer<typeof UserActSchema>;
export type ThreadRelation = z.infer<typeof ThreadRelationSchema>;
export type TurnInterpretation = z.infer<typeof TurnInterpretationSchema>;
