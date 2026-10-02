import type { TurnPlan } from "../../commander-v3/types/turn-plan.js";
import type { TurnDecision } from "../types/decision.js";
import type { TurnInterpretation } from "../types/interpretation.js";
import { KEEP_OR_CLOSE_PURPOSE } from "../../commander-v3/enrich/open-task-hold.js";

export function planFromDecision(input: {
  decision: TurnDecision;
  interpretation: TurnInterpretation;
}): TurnPlan {
  const { decision: d, interpretation: i } = input;
  const interpretationBlock = {
    userQuestion: i.normalizedMeaning,
    answerKind:
      d.conversationalAct === "greet"
        ? "greet"
        : d.action === "clarify" || d.action === "keep_or_close"
          ? "clarify"
          : d.conversationalAct === "answer_lateral"
            ? "other"
            : "other",
    threadRelation:
      d.action === "keep_or_close"
        ? "interrupt"
        : i.relation === "answer_expected"
          ? "capture"
          : i.relation === "side_question"
            ? "interrupt"
            : i.relation === "switch" || i.relation === "replace"
              ? "interrupt"
              : i.relation === "confirm"
                ? "write_confirm"
                : i.relation === "cancel"
                  ? "write_cancel"
                  : "standalone",
  } as TurnPlan["interpretation"];

  const nextQuestion = d.responseGoal.nextQuestion ?? null;
  const purpose =
    d.action === "keep_or_close"
      ? "clarify"
      : d.responseGoal.purpose;

  return {
    reasoning: d.reasoning,
    interpretation: interpretationBlock,
    conversationalAct: d.conversationalAct,
    task: d.task ?? null,
    taskAction: d.taskAction ?? null,
    suppliedFields: d.suppliedFields ?? null,
    unitReference: d.unitReference ?? null,
    companyReference: d.companyReference ?? null,
    lateralQuestion: d.lateralQuestion ?? null,
    parkedTurn: d.parkedTurn ?? null,
    requestedCapabilities: d.authorizedCapabilities,
    stateIntent: d.stateIntent,
    responseGoal: {
      purpose,
      facts: d.responseGoal.facts ?? [],
      nextQuestion:
        d.action === "keep_or_close"
          ? nextQuestion
          : d.responseGoal.nextQuestion,
    },
    confidence: d.confidence,
  };
}

export function annotateKeepOrClosePurpose(plan: TurnPlan): TurnPlan {
  if (plan.responseGoal.purpose === "clarify" && plan.responseGoal.nextQuestion) {
    return {
      ...plan,
      responseGoal: {
        ...plan.responseGoal,
        purpose: "clarify",
      },
    };
  }
  return plan;
}

export function lastQuestionForKeepOrClose(plan: TurnPlan): {
  id: string;
  purpose: string;
  expected: "clarification";
} | null {
  if (
    plan.responseGoal.purpose === "clarify" &&
    plan.responseGoal.nextQuestion &&
    plan.conversationalAct === "ask"
  ) {
    return {
      id: `kq_${Date.now().toString(36)}`,
      purpose: KEEP_OR_CLOSE_PURPOSE,
      expected: "clarification",
    };
  }
  return null;
}
