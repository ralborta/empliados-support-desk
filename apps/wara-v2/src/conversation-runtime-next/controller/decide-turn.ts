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
import {
  capabilityForServiceId,
} from "../registry/service-registry.js";

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

function keepOrCloseQuestion(state: ConversationStateV3): string {
  const label = taskLabel(state.activeTask?.type);
  return `Tenías pendiente el ${label}. ¿Seguimos con eso o preferís otra consulta?`;
}

export function decideTurn(input: {
  interpretation: TurnInterpretation;
  state: ConversationStateV3;
  message: string;
}): TurnDecision {
  const { interpretation: i, state, message } = input;
  const baseIntent = {
    preserveCompany: true,
    preserveUnit: true,
    preserveTask: true,
  };

  // Seguridad escritura: determinístico, no intención libre.
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

  // Respuesta a keep_or_close
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

  // Saludo puro con trabajo incompleto → no GPS ni slots.
  if (isPureGreetingMessage(message) && hasIncompleteWork(state)) {
    return {
      action: "keep_or_close",
      reasoning: "Saludo con trabajo incompleto: preguntar si continúa o cambia.",
      authorizedCapabilities: [],
      conversationalAct: "ask",
      stateIntent: baseIntent,
      responseGoal: {
        purpose: "clarify",
        facts: [],
        nextQuestion: keepOrCloseQuestion(state),
      },
      confidence: Math.max(i.confidence, 0.9),
      interpretationSummary: i.normalizedMeaning,
    };
  }

  // Saludo sin trabajo abierto
  if (i.userAct === "greeting" || isPureGreetingMessage(message)) {
    return {
      action: "respond",
      reasoning: "Saludo standalone.",
      authorizedCapabilities: [],
      conversationalAct: "greet",
      stateIntent: baseIntent,
      responseGoal: { purpose: "inform", facts: ["hola"], nextQuestion: null },
      confidence: i.confidence,
      interpretationSummary: i.normalizedMeaning,
    };
  }

  // Ambigüedad explícita del intérprete
  if (i.ambiguity?.clarificationQuestion) {
    return {
      action: "clarify",
      reasoning: i.ambiguity.reason,
      authorizedCapabilities: [],
      conversationalAct: "ask",
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

  // Pregunta lateral / side_question
  if (
    i.relation === "side_question" ||
    (i.userAct === "question" &&
      hasIncompleteWork(state) &&
      i.relation !== "answer_expected")
  ) {
    const caps = capsFromRequests(i);
    const readCaps = caps.filter((c) => {
      const def = getCapability(c.name);
      return def?.kind === "read" || c.name === "domain.answer";
    });
    return {
      action: "execute",
      reasoning: "Pregunta lateral: ejecutar lectura y preservar trámite.",
      authorizedCapabilities: readCaps,
      conversationalAct: "answer_lateral",
      lateralQuestion: {
        topic: i.normalizedMeaning,
        preserveTask: true,
      },
      stateIntent: baseIntent,
      responseGoal: { purpose: "inform", facts: [], nextQuestion: null },
      confidence: i.confidence,
      interpretationSummary: i.normalizedMeaning,
    };
  }

  // Respuesta al campo esperado
  if (
    i.relation === "answer_expected" ||
    i.answersExpectedField ||
    i.userAct === "answer"
  ) {
    const supplied =
      i.expectedFieldValue != null
        ? { value: Number(i.expectedFieldValue) || undefined }
        : undefined;
    const expected = state.lastQuestion?.expected;
    const fields =
      expected === "value" && i.expectedFieldValue != null
        ? { value: Number(i.expectedFieldValue) }
        : expected === "date" && i.expectedFieldValue != null
          ? { date: String(i.expectedFieldValue) }
          : expected === "time" && i.expectedFieldValue != null
            ? { time: String(i.expectedFieldValue) }
            : supplied;
    const task = state.activeTask?.type ?? null;
    return {
      action: "execute",
      reasoning: "Captura de campo esperado.",
      authorizedCapabilities: [],
      conversationalAct: "continue_task",
      task,
      taskAction: "continue",
      suppliedFields: fields ?? undefined,
      stateIntent: baseIntent,
      responseGoal: { purpose: "ask_missing", facts: [], nextQuestion: null },
      confidence: i.confidence,
      interpretationSummary: i.normalizedMeaning,
    };
  }

  // Cambio de trámite / switch
  if (i.relation === "switch" || i.relation === "replace") {
    const caps = capsFromRequests(i);
    const domain = i.requests[0]?.domain ?? caps[0]?.name.split(".")[0];
    const task = taskFromDomain(domain ?? "");
    return {
      action: "execute",
      reasoning: "Cambio de trámite o foco.",
      authorizedCapabilities: caps,
      conversationalAct: hasIncompleteWork(state) ? "switch_task" : "start_task",
      task,
      taskAction: hasIncompleteWork(state) ? "switch" : "start",
      stateIntent: { preserveCompany: true, preserveUnit: true, preserveTask: false },
      responseGoal: { purpose: "inform", facts: [], nextQuestion: null },
      confidence: i.confidence,
      interpretationSummary: i.normalizedMeaning,
    };
  }

  // Cancelación explícita
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

  // Pedido operativo / request
  const caps = capsFromRequests(i);
  const primary = i.requests[0];
  const task =
    primary?.domain ? taskFromDomain(primary.domain) : null;
  const hasWritePrepare = caps.some((c) => {
    const def = getCapability(c.name);
    return def?.kind === "write_prepare";
  });

  return {
    action: "execute",
    reasoning: i.normalizedMeaning,
    authorizedCapabilities: caps,
    conversationalAct: hasWritePrepare || task ? "start_task" : "inform",
    task,
    taskAction: task ? "start" : undefined,
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
