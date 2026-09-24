import type { TurnInterpretation } from "../types/interpretation.js";
import type { CapabilityRequest } from "../../commander-v3/types/turn-plan.js";

/** Cambio explícito de trámite — basado en interpretación LLM, no en el mensaje crudo. */
export function isExplicitTaskChange(interpretation: TurnInterpretation): boolean {
  if (interpretation.relation === "switch" || interpretation.relation === "replace") {
    return true;
  }
  if (interpretation.userAct === "cancellation" && interpretation.requests.length > 0) {
    return true;
  }
  if (interpretation.relation === "cancel" && interpretation.requests.length > 0) {
    return true;
  }
  if (interpretation.userAct === "correction" && interpretation.requests.length > 0) {
    return true;
  }
  return false;
}

export function isLateralQuestion(interpretation: TurnInterpretation): boolean {
  return (
    interpretation.relation === "side_question" ||
    interpretation.userAct === "question" &&
      interpretation.relation !== "answer_expected" &&
      interpretation.relation !== "switch" &&
      interpretation.relation !== "replace"
  );
}

function capFamily(name: string): string {
  if (name === "domain.answer") return "domain";
  if (name.startsWith("handoff.")) return "human_handoff";
  return name.split(".")[0] ?? name;
}

export function hasForeignCapability(
  caps: CapabilityRequest[],
  openType: string | undefined,
): boolean {
  if (!openType) return false;
  return caps.some((c) => {
    const fam = capFamily(c.name);
    return fam !== openType && fam !== "unit" && fam !== "company" && fam !== "domain";
  });
}

export function needsKeepOrCloseForIncompatible(
  interpretation: TurnInterpretation,
  requestCaps: CapabilityRequest[],
  openTaskType: string | undefined,
  hasOpenWork: boolean,
): boolean {
  if (!hasOpenWork) return false;
  if (isExplicitTaskChange(interpretation)) return false;
  if (interpretation.ambiguity?.clarificationQuestion) return false;
  if (isLateralQuestion(interpretation)) return false;
  if (interpretation.relation === "answer_expected" || interpretation.answersExpectedField) {
    return false;
  }
  return hasForeignCapability(requestCaps, openTaskType);
}
