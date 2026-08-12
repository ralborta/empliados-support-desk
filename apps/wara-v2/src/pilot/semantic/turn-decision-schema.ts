/**
 * Contrato TurnDecision — cerebro semántico unificado V2.
 * Autoridad única cuando WARA_V2_UNIFIED_SEMANTIC_BRAIN=true.
 */
import { z } from "zod";

export const TurnDecisionActionSchema = z.enum([
  "answer_pending",
  "start_intent",
  "switch_intent",
  "suspend_and_start",
  "resume",
  "correct_fields",
  "provide_fields",
  "select_entity",
  "lateral_query",
  "clarify",
  "general",
]);

export const TurnDecisionIntentSchema = z.enum([
  "unit_list",
  "unit_search",
  "gps",
  "odometer",
  "horometer",
  "maintenance",
  "certificate",
  "ticket",
  "human_handoff",
  "none",
]);

export const ReasoningCodeSchema = z.enum([
  "ANSWER_TO_PENDING",
  "NEW_EXPLICIT_INTENT",
  "SWITCH_INTENT",
  "AMBIGUOUS_NEGATION",
  "PROVIDED_MISSING_FIELD",
  "CONTEXTUAL_REFERENCE",
  "LATERAL_QUERY",
  "INSUFFICIENT_CONTEXT",
  "GENERAL_CONVERSATION",
]);

export const TurnDecisionSchema = z.object({
  action: TurnDecisionActionSchema,
  intent: TurnDecisionIntentSchema,
  confidence: z.number().min(0).max(1),
  answer: z.enum(["confirm", "reject", "cancel"]).nullable().optional(),
  entity: z
    .object({
      type: z.enum(["plate", "unit_name", "index", "contextual"]),
      value: z.string().nullable().optional(),
      matchMode: z.enum(["exact", "prefix", "suffix", "contains"]).nullable().optional(),
    })
    .nullable()
    .optional(),
  fields: z
    .object({
      numericValue: z.number().nullable().optional(),
      date: z.string().nullable().optional(),
      time: z.string().nullable().optional(),
      timezone: z.string().nullable().optional(),
      detail: z.string().nullable().optional(),
      certificateType: z.string().nullable().optional(),
      maintenanceType: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  currentTramiteDisposition: z.enum(["keep", "suspend", "cancel", "complete"]),
  ambiguity: z
    .object({
      candidates: z.array(z.string()).min(1),
      question: z.string().min(1),
    })
    .nullable()
    .optional(),
  reasoningCode: ReasoningCodeSchema,
});

export type TurnDecision = z.infer<typeof TurnDecisionSchema>;

export function validateTurnDecision(raw: unknown): TurnDecision | null {
  const parsed = TurnDecisionSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** Aclaración segura cuando el modelo falla. */
export function safeClarifyDecision(question?: string): TurnDecision {
  return {
    action: "clarify",
    intent: "none",
    confidence: 0.2,
    currentTramiteDisposition: "keep",
    ambiguity: {
      candidates: ["no_entendido", "repetir"],
      question:
        question ??
        "No pude interpretar bien eso. ¿Querés cancelar el trámite pendiente?",
    },
    reasoningCode: "INSUFFICIENT_CONTEXT",
  };
}
