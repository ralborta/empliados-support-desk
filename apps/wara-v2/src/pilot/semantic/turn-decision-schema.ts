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
  "answer_domain_question",
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
  "domain_knowledge",
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
  "DOMAIN_QUESTION",
  "INSUFFICIENT_CONTEXT",
  "GENERAL_CONVERSATION",
]);

export const DomainQuestionSchema = z
  .object({
    topic: z.enum([
      "odometer",
      "horometer",
      "gps",
      "certificate",
      "maintenance",
      "ticket",
      "unit",
      "wara",
      "other_supported",
      "out_of_domain",
    ]),
    questionType: z.enum([
      "definition",
      "purpose",
      "how_it_works",
      "why_needed",
      "required_data",
      "consequence",
      "status_explanation",
      "capabilities",
      "comparison",
    ]),
    resumeActiveTramite: z.boolean(),
  })
  .nullable()
  .optional();

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
      reference: z
        .enum([
          "selected_unit",
          "previous_selected_unit",
          "last_mentioned_unit",
          "current_list_item",
          "same_as_before",
        ])
        .nullable()
        .optional(),
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
  domainQuestion: DomainQuestionSchema,
  currentTramiteDisposition: z.enum(["keep", "suspend", "cancel", "complete"]),
  fieldsToClear: z
    .array(z.enum(["date", "time", "numericValue", "unit"]))
    .nullable()
    .optional(),
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

/** Normaliza salidas frecuentes del LLM antes de validar. */
export function coerceTurnDecisionRaw(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const o = { ...(raw as Record<string, unknown>) };
  const nullish = (v: unknown) => (v === "" || v === undefined ? null : v);
  if ("answer" in o) o.answer = nullish(o.answer);
  if ("fields" in o) o.fields = nullish(o.fields);
  if ("ambiguity" in o) o.ambiguity = nullish(o.ambiguity);
  if ("fieldsToClear" in o) o.fieldsToClear = nullish(o.fieldsToClear);
  if ("domainQuestion" in o) o.domainQuestion = nullish(o.domainQuestion);
  if (o.entity && typeof o.entity === "object" && !Array.isArray(o.entity)) {
    const e = { ...(o.entity as Record<string, unknown>) };
    e.value = nullish(e.value);
    e.matchMode = nullish(e.matchMode);
    const ref = nullish(e.reference);
    const allowedRef = new Set([
      "selected_unit",
      "previous_selected_unit",
      "last_mentioned_unit",
      "current_list_item",
      "same_as_before",
    ]);
    e.reference =
      typeof ref === "string" && allowedRef.has(ref) ? ref : null;
    o.entity = e;
  } else if ("entity" in o) {
    o.entity = nullish(o.entity);
  }
  // Códigos cercanos que el modelo inventa a veces.
  const reasonMap: Record<string, string> = {
    PREFIX_SEARCH: "CONTEXTUAL_REFERENCE",
    PLATE_PREFIX: "CONTEXTUAL_REFERENCE",
    ENTITY_SEARCH: "CONTEXTUAL_REFERENCE",
    SEARCH_UNIT: "CONTEXTUAL_REFERENCE",
    NEW_INTENT: "NEW_EXPLICIT_INTENT",
    EXPLICIT_INTENT: "NEW_EXPLICIT_INTENT",
  };
  if (typeof o.reasoningCode === "string" && reasonMap[o.reasoningCode]) {
    o.reasoningCode = reasonMap[o.reasoningCode];
  }
  return o;
}

export function validateTurnDecision(raw: unknown): TurnDecision | null {
  const parsed = TurnDecisionSchema.safeParse(coerceTurnDecisionRaw(raw));
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
        "No pude interpretar bien ese mensaje. ¿Podés decirme la patente o qué trámite querés hacer?",
    },
    reasoningCode: "INSUFFICIENT_CONTEXT",
  };
}
