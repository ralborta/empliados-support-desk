import type { ConversationStateV3 } from "../../commander-v3/types/state.js";
import type { CapabilityRequest } from "../../commander-v3/types/turn-plan.js";
import {
  isConfirmationReject,
  isUnequivocalWriteConfirm,
} from "../../commander-v3/enrich/confirmation-outcome.js";
import {
  hasIncompleteWork,
  KEEP_OR_CLOSE_PURPOSE,
  taskLabel,
} from "../../commander-v3/enrich/open-task-hold.js";
import { isPureGreetingMessage } from "../../commander-v3/enrich/greeting-policy.js";
import { getCapability } from "../../commander-v3/capabilities/catalog.js";
import type { TurnInterpretation } from "../types/interpretation.js";
import type { TurnDecision } from "../types/decision.js";
import { capabilityForServiceId } from "../registry/service-registry.js";
import { migrateV3ToVNext } from "../state/migrate.js";
import { incompleteTask } from "../state/reduce.js";
import { resolveInterpretationReferences } from "./resolve-references.js";
import {
  isExplicitTaskChange,
  isLateralQuestion,
  needsKeepOrCloseForIncompatible,
} from "./explicit-change.js";

function taskFromDomain(domain: string): TurnDecision["task"] {
  switch (domain) {
    case "certificate":
      return "certificate";
    case "odometer":
      return "odometer";
    case "hourmeter":
      return "hourmeter";
    case "maintenance":
      return "maintenance";
    case "human_handoff":
      return "human_handoff";
    case "gps":
      return "gps";
    case "unit":
      return "unit_query";
    default:
      return null;
  }
}

function capsFromRequests(interp: TurnInterpretation): CapabilityRequest[] {
  const caps: CapabilityRequest[] = [];
  for (const r of interp.requests) {
    const capName =
      (r.serviceId && capabilityForServiceId(r.serviceId)) ||
      (r.domain === "gps" ? "gps.get_status" : null);
    if (!capName) continue;
    const params: Record<string, unknown> = { ...r.entities };
    if (r.serviceId === "company.list" && interp.relation === "switch") {
      params.reset = true;
    }
    caps.push({ name: capName, params });
  }
  return caps;
}

function keepOrCloseQuestion(openType: string | undefined): string {
  const label = taskLabel(openType ?? null);
  return `Tenías pendiente ${label}. ¿Seguimos con eso o preferís otra consulta?`;
}

function buildSwitchDecision(
  i: TurnInterpretation,
  state: ConversationStateV3,
  requestCaps: CapabilityRequest[],
  refs: ReturnType<typeof resolveInterpretationReferences>,
  openV3: boolean,
): TurnDecision {
  const domain = i.requests[0]?.domain ?? requestCaps[0]?.name.split(".")[0];
  const task = taskFromDomain(domain ?? "");
  const baseIntent = { preserveCompany: true, preserveUnit: true, preserveTask: false };
  return {
    action: "execute",
    reasoning: "Cambio explícito de trámite: avanzar al nuevo servicio.",
    authorizedCapabilities: requestCaps,
    conversationalAct: openV3 ? "switch_task" : "start_task",
    task,
    taskAction: openV3 ? "switch" : "start",
    unitReference: refs.unitReference ?? null,
    companyReference: refs.companyReference ?? null,
    stateIntent: baseIntent,
    responseGoal: { purpose: "inform", facts: [], nextQuestion: null },
    confidence: i.confidence,
    interpretationSummary: i.normalizedMeaning,
  };
}

export function decideTurn(input: {
  interpretation: TurnInterpretation;
  state: ConversationStateV3;
  message: string;
}): TurnDecision {
  const { interpretation: i, state, message } = input;
  const vnext = migrateV3ToVNext(state);
  const baseIntent = {
    preserveCompany: true,
    preserveUnit: true,
    preserveTask: true,
  };

  const refs = resolveInterpretationReferences(i, vnext);
  if (refs.clarifyQuestion && !i.ambiguity?.clarificationQuestion) {
    return {
      action: "clarify",
      reasoning: "Referencia ambigua o no resuelta.",
      authorizedCapabilities: [],
      conversationalAct: "ask",
      unitReference: refs.unitReference ?? null,
      companyReference: refs.companyReference ?? null,
      stateIntent: baseIntent,
      responseGoal: {
        purpose: "clarify",
        facts: [],
        nextQuestion: refs.clarifyQuestion,
      },
      confidence: i.confidence,
      interpretationSummary: i.normalizedMeaning,
    };
  }

  if (state.pendingWrite || state.lastQuestion?.expected === "confirmation") {
    if (isUnequivocalWriteConfirm(message)) {
      const task = state.pendingWrite?.task ?? state.activeTask?.type ?? "certificate";
      const commitCap =
        task === "odometer"
          ? "odometer.update"
          : task === "hourmeter"
            ? "hourmeter.update"
            : task === "maintenance"
              ? "maintenance.create"
              : task === "human_handoff"
                ? "handoff.create"
                : "certificate.issue";
      return {
        action: "confirm_write",
        reasoning: "Confirmación inequívoca con pendingWrite.",
        authorizedCapabilities: [{ name: commitCap, params: {} }],
        conversationalAct: "confirm_write",
        taskAction: "confirm",
        stateIntent: baseIntent,
        responseGoal: { purpose: "confirm_write", facts: [], nextQuestion: null },
        confidence: 1,
        interpretationSummary: i.normalizedMeaning,
      };
    }
    if (isConfirmationReject(message)) {
      return {
        action: "cancel",
        reasoning: "Rechazo de confirmación pendiente.",
        authorizedCapabilities: [],
        conversationalAct: "cancel_task",
        taskAction: "cancel",
        stateIntent: { ...baseIntent, preserveTask: false },
        responseGoal: { purpose: "inform", facts: [], nextQuestion: null },
        confidence: 1,
        interpretationSummary: i.normalizedMeaning,
      };
    }
  }

  if (state.lastQuestion?.purpose === KEEP_OR_CLOSE_PURPOSE) {
    if (i.userAct === "cancellation" || i.relation === "cancel") {
      return {
        action: "cancel",
        reasoning: "Usuario cierra trámite pendiente.",
        authorizedCapabilities: [],
        conversationalAct: "cancel_task",
        taskAction: "cancel",
        stateIntent: { ...baseIntent, preserveTask: false },
        responseGoal: { purpose: "close", facts: [], nextQuestion: null },
        confidence: i.confidence,
        interpretationSummary: i.normalizedMeaning,
      };
    }
    if (i.relation === "resume" || i.userAct === "acknowledgement") {
      return {
        action: "resume",
        reasoning: "Usuario retoma trámite pendiente.",
        authorizedCapabilities: [],
        conversationalAct: "continue_task",
        taskAction: "continue",
        stateIntent: baseIntent,
        responseGoal: { purpose: "resume", facts: [], nextQuestion: null },
        confidence: i.confidence,
        interpretationSummary: i.normalizedMeaning,
      };
    }
  }

  const openTask = incompleteTask(vnext);
  const openV3 = hasIncompleteWork(state);
  const requestCaps = capsFromRequests(i);

  if (isPureGreetingMessage(message) || (i.userAct === "greeting" && i.relation !== "switch")) {
    if (isPureGreetingMessage(message) || i.relation === "pause" || i.relation === "standalone") {
      return {
        action: "respond",
        reasoning: "Saludo natural conservando trámite pendiente si existe.",
        authorizedCapabilities: [],
        conversationalAct: "greet",
        stateIntent: baseIntent,
        responseGoal: { purpose: "inform", facts: ["hola"], nextQuestion: null },
        confidence: Math.max(i.confidence, 0.9),
        interpretationSummary: i.normalizedMeaning,
      };
    }
  }

  if (i.ambiguity?.clarificationQuestion) {
    return {
      action: "clarify",
      reasoning: i.ambiguity.reason,
      authorizedCapabilities: [],
      conversationalAct: "ask",
      unitReference: refs.unitReference ?? null,
      companyReference: refs.companyReference ?? null,
      stateIntent: baseIntent,
      responseGoal: {
        purpose: "clarify",
        facts: [],
        nextQuestion: i.ambiguity.clarificationQuestion,
      },
      confidence: i.confidence,
      interpretationSummary: i.normalizedMeaning,
    };
  }

  // Cambio explícito ANTES de keep_or_close o lateral.
  if (isExplicitTaskChange(i)) {
    return buildSwitchDecision(i, state, requestCaps, refs, openV3);
  }

  if (isLateralQuestion(i) && openV3) {
    const readCaps = requestCaps.filter((c) => {
      const def = getCapability(c.name);
      return def?.kind === "read" || c.name === "domain.answer";
    });
    return {
      action: "execute",
      reasoning: "Pregunta lateral: lectura preservando trámite.",
      authorizedCapabilities: readCaps,
      conversationalAct: "answer_lateral",
      lateralQuestion: { topic: i.normalizedMeaning, preserveTask: true },
      unitReference: refs.unitReference ?? null,
      companyReference: refs.companyReference ?? null,
      stateIntent: baseIntent,
      responseGoal: { purpose: "inform", facts: [], nextQuestion: null },
      confidence: i.confidence,
      interpretationSummary: i.normalizedMeaning,
    };
  }

  if (
    needsKeepOrCloseForIncompatible(i, requestCaps, openTask?.type, openV3)
  ) {
    return {
      action: "keep_or_close",
      reasoning: "Nueva solicitud incompatible sin abandono explícito.",
      authorizedCapabilities: [],
      conversationalAct: "ask",
      unitReference: refs.unitReference ?? null,
      companyReference: refs.companyReference ?? null,
      stateIntent: baseIntent,
      responseGoal: {
        purpose: "clarify",
        facts: [],
        nextQuestion: keepOrCloseQuestion(openTask?.type),
      },
      confidence: i.confidence,
      interpretationSummary: i.normalizedMeaning,
    };
  }

  if (i.relation === "answer_expected" || i.answersExpectedField || i.userAct === "answer") {
    const expected = state.lastQuestion?.expected;
    const fields =
      expected === "value" && i.expectedFieldValue != null
        ? { value: Number(i.expectedFieldValue) }
        : expected === "date" && i.expectedFieldValue != null
          ? { date: String(i.expectedFieldValue) }
          : expected === "time" && i.expectedFieldValue != null
            ? { time: String(i.expectedFieldValue) }
            : undefined;
    return {
      action: "execute",
      reasoning: "Captura de campo esperado.",
      authorizedCapabilities: [],
      conversationalAct: "continue_task",
      task: openTask?.type ?? state.activeTask?.type ?? null,
      taskAction: "continue",
      suppliedFields: fields ?? undefined,
      unitReference: refs.unitReference ?? null,
      companyReference: refs.companyReference ?? null,
      stateIntent: baseIntent,
      responseGoal: { purpose: "ask_missing", facts: [], nextQuestion: null },
      confidence: i.confidence,
      interpretationSummary: i.normalizedMeaning,
    };
  }

  if (i.userAct === "cancellation" || i.relation === "cancel") {
    return {
      action: "cancel",
      reasoning: "Cancelación explícita.",
      authorizedCapabilities: [],
      conversationalAct: "cancel_task",
      taskAction: "cancel",
      stateIntent: { ...baseIntent, preserveTask: false },
      responseGoal: { purpose: "close", facts: [], nextQuestion: null },
      confidence: i.confidence,
      interpretationSummary: i.normalizedMeaning,
    };
  }

  const primary = i.requests[0];
  const task = primary?.domain ? taskFromDomain(primary.domain) : null;
  const hasWritePrepare = requestCaps.some((c) => getCapability(c.name)?.kind === "write_prepare");

  return {
    action: "execute",
    reasoning: i.normalizedMeaning,
    authorizedCapabilities: requestCaps,
    conversationalAct: hasWritePrepare || task ? "start_task" : "inform",
    task,
    taskAction: task ? "start" : undefined,
    unitReference: refs.unitReference ?? null,
    companyReference: refs.companyReference ?? null,
    stateIntent: baseIntent,
    responseGoal: {
      purpose: hasWritePrepare ? "ask_missing" : "inform",
      facts: [],
      nextQuestion: null,
    },
    confidence: i.confidence,
    interpretationSummary: i.normalizedMeaning,
  };
}

export function filterAuthorizedCapabilities(
  decision: TurnDecision,
): CapabilityRequest[] {
  return decision.authorizedCapabilities.filter((c) => {
    const def = getCapability(c.name);
    if (!def) return false;
    if (def.kind === "write_commit" && decision.action !== "confirm_write") {
      return false;
    }
    return true;
  });
}
