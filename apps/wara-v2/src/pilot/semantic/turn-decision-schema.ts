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
  "query_context",
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
  "query_active_company",
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
  "QUERY_CONTEXT",
  "INSUFFICIENT_CONTEXT",
  "GENERAL_CONVERSATION",
  "AMEND_PENDING_SLOT",
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
      "platform_unidades",
      "platform_opciones",
      "platform_mantenimiento",
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

export const SpeechActSchema = z.enum([
  "provide_field",
  "query_context",
  "start_intent",
  "change_intent",
  "negate_intent",
  "cancel",
  "confirm",
  "amend",
  "farewell",
  "courtesy",
  "clarify",
]);

/**
 * Acto social fino (saludo / agradecimiento / despedida).
 * No reemplaza speechAct ni modifica action/intent/disposition.
 * Solo presentación (p. ej. humanizar saludo).
 */
export const SocialActSchema = z.enum(["greeting", "thanks", "farewell"]);

export const CompanyActionSchema = z.enum(["query_active", "select", "change", "keep"]);

/** Qué intención/cambio niega el usuario. Enum cerrado — no inspeccionar texto libre. */
export const NegatedActionSchema = z.enum(["change_company", "change_unit"]);

/** Slot a enmendar dentro del trámite activo (sin cancelar ni confirmar escritura). */
export const AmendTargetSchema = z.enum([
  "company",
  "unit",
  "value",
  "date",
  "time",
  "detail",
  "priority",
]);

export const DispositionExtSchema = z.enum([
  "continue_active",
  "replace_active",
  "cancel_active",
  "keep_current",
  "close",
  "answer_only",
]);

export type NegatedAction = z.infer<typeof NegatedActionSchema>;
export type AmendTarget = z.infer<typeof AmendTargetSchema>;

/** Keep de empresa: companyAction=keep + negatedAction=change_company + speechAct tipado. */
export function isStructuredCompanyKeep(decision: {
  speechAct?: string | null;
  companyAction?: string | null;
  negatedAction?: string | null;
}): boolean {
  return (
    decision.companyAction === "keep" &&
    decision.negatedAction === "change_company" &&
    (decision.speechAct === "negate_intent" || decision.speechAct === "amend")
  );
}

/** Amend estructurado: speechAct + amendTarget (enum cerrado). */
export function isStructuredAmend(decision: {
  speechAct?: string | null;
  amendTarget?: string | null;
}): boolean {
  return decision.speechAct === "amend" && decision.amendTarget != null;
}

export const TurnDecisionSchema = z.object({
  action: TurnDecisionActionSchema,
  intent: TurnDecisionIntentSchema,
  confidence: z.number().min(0).max(1),
  answer: z.enum(["confirm", "reject", "cancel"]).nullable().optional(),
  /** Acto de habla explícito — autoridad semántica del turno. */
  speechAct: SpeechActSchema.nullable().optional(),
  /**
   * Acto social fino (greeting|thanks|farewell).
   * No altera action/intent/disposition; no autoriza escrituras.
   */
  socialAct: SocialActSchema.nullable().optional(),
  /** Acción de empresa (query/select/change/keep). Nunca inferir por includes. */
  companyAction: CompanyActionSchema.nullable().optional(),
  /** Disposition extendida (opcional; mapea a currentTramiteDisposition). */
  disposition: DispositionExtSchema.nullable().optional(),
  negatedAction: NegatedActionSchema.nullable().optional(),
  /** Slot a modificar sin cancelar el trámite (requiere speechAct=amend). */
  amendTarget: AmendTargetSchema.nullable().optional(),
  answerToQuestionId: z.string().nullable().optional(),
  targetIntent: TurnDecisionIntentSchema.nullable().optional(),
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
      /** Alias de contrato: value → numericValue */
      value: z.number().nullable().optional(),
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
  companyReference: z.enum(["active", "none", "named"]).nullable().optional(),
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
  if ("speechAct" in o) o.speechAct = nullish(o.speechAct);
  if ("socialAct" in o) {
    const v = nullish(o.socialAct);
    const allowed = SocialActSchema.safeParse(v);
    o.socialAct = allowed.success ? allowed.data : null;
  }
  if ("companyAction" in o) o.companyAction = nullish(o.companyAction);
  if ("disposition" in o) o.disposition = nullish(o.disposition);
  if ("negatedAction" in o) {
    const v = nullish(o.negatedAction);
    const allowed = NegatedActionSchema.safeParse(v);
    o.negatedAction = allowed.success ? allowed.data : null;
  }
  if ("amendTarget" in o) {
    const v = nullish(o.amendTarget);
    const allowed = AmendTargetSchema.safeParse(v);
    o.amendTarget = allowed.success ? allowed.data : null;
  }
  if ("answerToQuestionId" in o) o.answerToQuestionId = nullish(o.answerToQuestionId);
  if ("targetIntent" in o) o.targetIntent = nullish(o.targetIntent);
  if ("fields" in o) o.fields = nullish(o.fields);
  if (o.fields && typeof o.fields === "object" && !Array.isArray(o.fields)) {
    const f = { ...(o.fields as Record<string, unknown>) };
    if ((f.numericValue == null || f.numericValue === undefined) && typeof f.value === "number") {
      f.numericValue = f.value;
    }
    o.fields = f;
  }
  if ("ambiguity" in o) o.ambiguity = nullish(o.ambiguity);
  if ("fieldsToClear" in o) o.fieldsToClear = nullish(o.fieldsToClear);
  if ("domainQuestion" in o) o.domainQuestion = nullish(o.domainQuestion);
  if ("companyReference" in o) o.companyReference = nullish(o.companyReference);
  // disposition extendida → currentTramiteDisposition
  if (!o.currentTramiteDisposition && typeof o.disposition === "string") {
    const map: Record<string, string> = {
      continue_active: "keep",
      keep_current: "keep",
      answer_only: "keep",
      replace_active: "cancel",
      cancel_active: "cancel",
      close: "cancel",
    };
    o.currentTramiteDisposition = map[o.disposition] ?? "keep";
  }
  // speechAct → action/intent hints cuando el modelo omite action
  if (typeof o.speechAct === "string" && !o.action) {
    const speechToAction: Record<string, string> = {
      provide_field: "provide_fields",
      query_context: "query_context",
      start_intent: "start_intent",
      change_intent: "switch_intent",
      negate_intent: "general",
      cancel: "answer_pending",
      confirm: "answer_pending",
      amend: "general",
      farewell: "general",
      courtesy: "general",
      clarify: "clarify",
    };
    o.action = speechToAction[o.speechAct] ?? o.action;
  }
  if (o.companyAction === "query_active") {
    o.action = "query_context";
    o.intent = o.intent && o.intent !== "none" ? o.intent : "query_active_company";
  }
  // companyAction=keep se maneja en reducer/execute — no forzar query_context.
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
    socialAct: null,
    ambiguity: {
      candidates: ["no_entendido", "repetir"],
      question:
        question ??
        "No pude interpretar bien ese mensaje. ¿Podés decirme la patente o qué trámite querés hacer?",
    },
    reasoningCode: "INSUFFICIENT_CONTEXT",
  };
}
