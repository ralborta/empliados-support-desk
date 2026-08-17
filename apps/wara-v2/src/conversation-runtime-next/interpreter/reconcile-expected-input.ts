import type { TurnInterpretation } from "../types/interpretation.js";
import type { ExpectedField } from "../state/vnext-types.js";

/**
 * Corrige clasificaciones LLM erróneas cuando el estado espera un campo concreto
 * y el mensaje es estructuralmente una respuesta (índice, código, valor), sin listas de frases.
 */
export function reconcileInterpretationWithPendingExpectedInput(input: {
  interpretation: TurnInterpretation;
  message: string;
  expectedField: ExpectedField | string | null | undefined;
}): TurnInterpretation {
  const field = normalizeExpectedField(input.expectedField);
  if (!field) return input.interpretation;

  const trimmed = input.message.trim();
  if (!trimmed) return input.interpretation;

  const i = input.interpretation;
  const structuralAnswer = isStructuralAnswerToExpectedField(trimmed, field);
  const misclassifiedAsNonAnswer =
    i.userAct === "greeting" ||
    i.userAct === "acknowledgement" ||
    (i.relation === "pause" && i.userAct !== "answer") ||
    ((i.userAct === "question" || i.relation === "side_question") && structuralAnswer);

  if (!misclassifiedAsNonAnswer) return i;
  if (!structuralAnswer) return i;

  return {
    ...i,
    userAct: "answer",
    relation: "answer_expected",
    answersExpectedField: true,
    expectedFieldValue: trimmed,
    normalizedMeaning: `Respuesta al campo esperado (${field})`,
    confidence: Math.max(i.confidence, 0.85),
  };
}

function normalizeExpectedField(
  field: ExpectedField | string | null | undefined,
): ExpectedField | null {
  if (
    field === "company" ||
    field === "unit" ||
    field === "value" ||
    field === "date" ||
    field === "time" ||
    field === "confirmation" ||
    field === "clarification" ||
    field === "free_text"
  ) {
    return field;
  }
  return null;
}

function isStructuralAnswerToExpectedField(message: string, field: ExpectedField): boolean {
  switch (field) {
    case "company":
      return /^\d{1,2}$/.test(message);
    case "unit":
      if (/^\d{3,}$/.test(message)) return true;
      if (/[0-9]/.test(message) && /^[A-Za-z0-9][A-Za-z0-9-]{1,24}$/.test(message)) {
        return true;
      }
      return false;
    case "value":
      return /^\d+([.,]\d+)?$/.test(message.replace(/\s/g, ""));
    case "date":
      return /^\d{1,2}[\/\-.]\d{1,2}([\/\-.]\d{2,4})?$/.test(message);
    case "time":
      return /^\d{1,2}:\d{2}$/.test(message);
    case "confirmation":
      return /^(s[ií]?|no|ok|dale|confirmo?)$/i.test(message);
    case "clarification":
    case "free_text":
      return false;
    default:
      return false;
  }
}
