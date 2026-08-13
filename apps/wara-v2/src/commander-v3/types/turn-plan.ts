import { z } from "zod";
import type { TaskTypeV3 } from "./state.js";

export const TaskTypeSchema = z.enum([
  "certificate",
  "odometer",
  "hourmeter",
  "maintenance",
  "gps",
  "unit_query",
  "human_handoff",
]);

export const ConversationalActSchema = z.enum([
  "greet",
  "inform",
  "ask",
  "start_task",
  "continue_task",
  "switch_task",
  "amend_task",
  "cancel_task",
  "confirm_write",
  "answer_lateral",
  "farewell",
  "handoff",
]);

export const EntityReferenceSchema = z
  .object({
    kind: z.enum(["company", "unit"]),
    mode: z.enum(["plate", "unit_name", "index", "contextual", "named", "id"]),
    value: z.string(),
    reference: z.enum(["active", "previous", "listed"]).nullable().optional(),
  })
  .nullable()
  .optional();

export const CapabilityRequestSchema = z.object({
  name: z.string(),
  params: z.record(z.string(), z.unknown()).optional().default({}),
});

export const TurnPlanSchema = z.object({
  /** Razonamiento breve del turno (obligatorio). No se muestra al usuario. */
  reasoning: z.string().min(1).max(800),
  conversationalAct: ConversationalActSchema,
  task: TaskTypeSchema.nullable().optional(),
  taskAction: z
    .enum(["start", "continue", "switch", "amend", "cancel", "confirm"])
    .nullable()
    .optional(),
  companyReference: EntityReferenceSchema,
  unitReference: EntityReferenceSchema,
  suppliedFields: z
    .object({
      value: z.number().nullable().optional(),
      date: z.string().nullable().optional(),
      time: z.string().nullable().optional(),
      observedAt: z.string().nullable().optional(),
      detail: z.string().nullable().optional(),
      priority: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  amendment: z
    .object({
      target: z.enum([
        "company",
        "unit",
        "value",
        "date",
        "time",
        "detail",
        "priority",
      ]),
    })
    .nullable()
    .optional(),
  lateralQuestion: z
    .object({
      topic: z.string(),
      preserveTask: z.boolean(),
    })
    .nullable()
    .optional(),
  requestedCapabilities: z.array(CapabilityRequestSchema).default([]),
  stateIntent: z.object({
    preserveCompany: z.boolean(),
    preserveUnit: z.boolean(),
    preserveTask: z.boolean(),
  }),
  responseGoal: z.object({
    purpose: z.enum([
      "inform",
      "ask_missing",
      "confirm_write",
      "clarify",
      "resume",
      "close",
    ]),
    facts: z.array(z.string()).default([]),
    nextQuestion: z.string().nullable().optional(),
  }),
  confidence: z.number().min(0).max(1),
});

export type TurnPlan = z.infer<typeof TurnPlanSchema>;
export type CapabilityRequest = z.infer<typeof CapabilityRequestSchema>;
export type TaskType = TaskTypeV3;
