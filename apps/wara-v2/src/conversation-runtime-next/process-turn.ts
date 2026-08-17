import { randomUUID } from "node:crypto";
import type { WaraUnidadEstado } from "../../pilot/wara-types.js";
import { formatUnitLabel, toFleetUnitRef } from "../../pilot/unit-fleet.js";
import { validateTurnPlan } from "../../commander-v3/validate/validate-plan.js";
import {
  resolveCompanyReference,
  resolveUnitReference,
} from "../../commander-v3/entities/resolve.js";
import {
  executeCapabilities,
  stripMeterValueConfusedWithUnit,
} from "../../commander-v3/execute/run-capabilities.js";
import { enrichPlanWithNaturalDatetime } from "../../commander-v3/enrich/natural-datetime-plan.js";
import { enrichPlanForCompanyOpsGate } from "../../commander-v3/enrich/company-ops-gate.js";
import { enrichPlanStripBareFleetDump } from "../../commander-v3/enrich/bare-fleet-dump.js";
import {
  KEEP_OR_CLOSE_PURPOSE,
  planFromParkedTurn,
  resumeQuestionForTask,
} from "../../commander-v3/enrich/open-task-hold.js";
import { applyCommanderState } from "../../commander-v3/state/apply-patch.js";
import { redactReply } from "../../commander-v3/reply/redact.js";
import {
  getConversationStateV3,
  saveConversationStateV3,
  saveLastTraceV3,
  createEmptyIfNeeded,
} from "../../commander-v3/persistence/store-helpers.js";
import type { ConversationStateV3 } from "../../commander-v3/types/state.js";
import type { CompanyRef } from "../../commander-v3/types/refs.js";
import type { TurnTraceV3 } from "../../commander-v3/observability/trace.js";
import type { TurnPlan } from "../../commander-v3/types/turn-plan.js";
import { DEFAULT_TENANT_TZ } from "../../pilot/semantic/natural-datetime.js";
import { DateTime } from "luxon";
import { callInterpreter } from "../interpreter/call.js";
import { decideTurn, filterAuthorizedCapabilities } from "../controller/decide-turn.js";
import {
  planFromDecision,
  lastQuestionForKeepOrClose,
} from "../controller/plan-from-decision.js";
import { mapExecResultsToStructured } from "../execute/adapt-results.js";
import {
  RUNTIME_NEXT_PROMPT_VERSION,
  SERVICE_REGISTRY_VERSION,
} from "../flags.js";
import { buildKnowledgeInventory } from "../registry/knowledge-inventory.js";
import type { TurnInterpretation } from "../types/interpretation.js";

export type ProcessConversationTurnInput = {
  tenantId: string;
  phone: string;
  message: string;
  messageId: string;
  env: NodeJS.ProcessEnv;
  contacts?: Array<{ id: number; nombre: string; empresa: string }>;
  fleetUnits?: WaraUnidadEstado[];
  customerName?: string | null;
  /** Bypass LLM para tests */
  interpretationOverride?: TurnInterpretation;
};

export type ProcessConversationTurnResult = {
  reply: string;
  state: ConversationStateV3;
  trace: TurnTraceV3 & {
    runtimeNext?: {
      interpretation: TurnInterpretation | null;
      inventory: ReturnType<typeof buildKnowledgeInventory>;
      capabilityResults: ReturnType<typeof mapExecResultsToStructured>;
    };
  };
};

function structuralFinalizePlan(
  plan: TurnPlan,
  state: ConversationStateV3,
): TurnPlan {
  let p = plan;
  const skipPrepare =
    p.conversationalAct === "greet" ||
    p.responseGoal.purpose === "clarify" ||
    Boolean(p.parkedTurn);

  const ensurePrepare = (task: "odometer" | "hourmeter" | "certificate", cap: string) => {
    if (skipPrepare || p.task !== task) return;
    if (!p.requestedCapabilities.some((c) => c.name === cap)) {
      p = {
        ...p,
        requestedCapabilities: [...p.requestedCapabilities, { name: cap, params: {} }],
      };
    }
  };
  ensurePrepare("odometer", "odometer.prepare");
  ensurePrepare("hourmeter", "hourmeter.prepare");
  ensurePrepare("certificate", "certificate.prepare");

  if (
    !p.parkedTurn &&
    p.task === "gps" &&
    !p.requestedCapabilities.some((c) => c.name === "gps.get_status")
  ) {
    p = {
      ...p,
      requestedCapabilities: [
        ...p.requestedCapabilities,
        { name: "gps.get_status", params: {} },
      ],
    };
  }

  if (
    p.task === "unit_query" &&
    !p.requestedCapabilities.some((c) => c.name === "unit.search")
  ) {
    p = {
      ...p,
      requestedCapabilities: [{ name: "unit.search", params: {} }, ...p.requestedCapabilities],
    };
  }

  p = enrichPlanForCompanyOpsGate(p, state);
  if (!state.fleetCache.length) {
    p = {
      ...p,
      requestedCapabilities: p.requestedCapabilities.filter((c) => c.name !== "unit.search"),
    };
  }
  return p;
}

export async function processConversationTurn(
  input: ProcessConversationTurnInput,
): Promise<ProcessConversationTurnResult> {
  const totalStart = Date.now();
  const inventory = buildKnowledgeInventory();
  const availableCompanies: CompanyRef[] = (input.contacts ?? []).map((c) => ({
    id: String(c.id),
    name: c.empresa || c.nombre,
    contactId: c.id,
  }));

  let state =
    getConversationStateV3(input.tenantId, input.phone) ??
    createEmptyIfNeeded(input.tenantId, input.phone, availableCompanies);

  if (availableCompanies.length && state.availableCompanies.length === 0) {
    state = { ...state, availableCompanies };
  }

  const fleetUnits = input.fleetUnits ?? [];
  if (fleetUnits.length) {
    state = {
      ...state,
      fleetCache: fleetUnits.map((u) => ({
        movilId: u.movil_id,
        plate: u.patente ?? null,
        name: u.unidad ?? null,
        label: formatUnitLabel(u),
        odometer: u.odometro ?? null,
        hourmeter: u.horometro ?? null,
      })),
    };
  }

  const stateBefore = structuredClone(state);
  const lastAssistantReply =
    [...state.recentTurns].reverse().find((t) => t.role === "assistant")?.text ?? null;

  let interpretMs = 0;
  let interpretRaw: unknown = null;
  let interpretModel = "";
  let interpretation: TurnInterpretation | null = null;

  if (input.interpretationOverride) {
    interpretation = input.interpretationOverride;
  } else {
    const ir = await callInterpreter({
      message: input.message,
      state,
      env: input.env,
      lastAssistantReply,
    });
    interpretMs = ir.latencyMs;
    interpretRaw = ir.raw;
    interpretModel = ir.model;
    interpretation = ir.interpretation;
  }

  if (!interpretation) {
    const fallbackPlan: TurnPlan = {
      reasoning: "Intérprete falló; aclaración puntual.",
      conversationalAct: "ask",
      requestedCapabilities: [],
      stateIntent: { preserveCompany: true, preserveUnit: true, preserveTask: true },
      responseGoal: {
        purpose: "clarify",
        facts: [],
        nextQuestion: "No entendí bien. ¿Qué necesitás hacer?",
      },
      confidence: 0.2,
    };
    const { reply, latencyMs: redactMs } = await redactReply({
      plan: fallbackPlan,
      facts: [],
      state,
      env: input.env,
      userMessage: input.message,
      lastAssistantReply,
    });
    const after = {
      ...state,
      recentTurns: [
        ...state.recentTurns,
        { role: "user" as const, text: input.message, at: new Date().toISOString() },
        { role: "assistant" as const, text: reply, at: new Date().toISOString() },
      ].slice(-20),
      updatedAt: new Date().toISOString(),
    };
    saveConversationStateV3(after);
    const trace = buildTrace({
      turnInput: input,
      stateBefore,
      stateAfter: after,
      plan: fallbackPlan,
      interpretMs,
      interpretRaw,
      interpretModel,
      redactMs,
      totalStart,
      inventory,
      interpretation: null,
      capabilityResults: [],
      validationOk: false,
    });
    saveLastTraceV3(input.tenantId, input.phone, trace);
    return { reply, state: after, trace };
  }

  let decision = decideTurn({
    interpretation,
    state,
    message: input.message,
  });
  decision = {
    ...decision,
    authorizedCapabilities: filterAuthorizedCapabilities(decision),
  };

  let plan = planFromDecision({ decision, interpretation });
  let validation = validateTurnPlan(plan, state);

  if (!validation.ok) {
    const clarifyPlan: TurnPlan = {
      reasoning: `Validación falló: ${validation.errors.join("; ")}`,
      conversationalAct: "ask",
      requestedCapabilities: [],
      stateIntent: { preserveCompany: true, preserveUnit: true, preserveTask: true },
      responseGoal: {
        purpose: "clarify",
        facts: [],
        nextQuestion: "Necesito una aclaración para seguir.",
      },
      confidence: 0.3,
    };
    const { reply, latencyMs: redactMs } = await redactReply({
      plan: clarifyPlan,
      facts: [],
      state,
      env: input.env,
      userMessage: input.message,
      lastAssistantReply,
    });
    const after = {
      ...state,
      recentTurns: [
        ...state.recentTurns,
        { role: "user" as const, text: input.message, at: new Date().toISOString() },
        { role: "assistant" as const, text: reply, at: new Date().toISOString() },
      ].slice(-20),
      updatedAt: new Date().toISOString(),
    };
    saveConversationStateV3(after);
    const trace = buildTrace({
      turnInput: input,
      stateBefore,
      stateAfter: after,
      plan: clarifyPlan,
      interpretMs,
      interpretRaw,
      interpretModel,
      redactMs,
      totalStart,
      inventory,
      interpretation,
      capabilityResults: [],
      validationOk: false,
    });
    saveLastTraceV3(input.tenantId, input.phone, trace);
    return { reply, state: after, trace };
  }

  const localNow = DateTime.now().setZone(DEFAULT_TENANT_TZ).toFormat("yyyy-MM-dd'T'HH:mm:ss");
  plan = enrichPlanWithNaturalDatetime(plan, state, input.message, {
    timezone: DEFAULT_TENANT_TZ,
    localNow,
  });

  // keep_or_close / resume / cancel (estructural, no enrich chain)
  if (state.lastQuestion?.purpose === KEEP_OR_CLOSE_PURPOSE) {
    if (decision.action === "cancel") {
      const parked = state.conversationMetadata.parkedTurn ?? null;
      state = {
        ...state,
        activeTask: null,
        pendingWrite: null,
        pendingEntity: null,
        lastQuestion: null,
        conversationMetadata: { ...state.conversationMetadata, parkedTurn: null },
      };
      if (parked) {
        plan = planFromParkedTurn(parked, plan);
      }
    } else if (decision.action === "resume") {
      state = {
        ...state,
        lastQuestion: state.activeTask ? resumeQuestionForTask(state.activeTask) : null,
        conversationMetadata: { ...state.conversationMetadata, parkedTurn: null },
      };
    }
  }

  if (
    (plan.task === "odometer" || plan.task === "hourmeter") &&
    plan.suppliedFields?.value != null
  ) {
    const cleaned = stripMeterValueConfusedWithUnit({
      value: plan.suppliedFields.value,
      unit: state.unit,
      message: input.message,
      unitReferenceValue:
        plan.unitReference?.kind === "unit"
          ? String(plan.unitReference.value ?? "")
          : null,
    });
    if (cleaned == null) {
      const fields = { ...plan.suppliedFields };
      delete fields.value;
      plan = { ...plan, suppliedFields: fields };
    }
  }

  plan = structuralFinalizePlan(plan, state);

  if (!state.company && state.availableCompanies.length === 1) {
    state = { ...state, company: state.availableCompanies[0]! };
  }

  const unitRes = resolveUnitReference(plan.unitReference ?? null, state);
  const companyRes = resolveCompanyReference(plan.companyReference ?? null, state);
  const resolvedUnit = unitRes.status === "exact" ? unitRes.unit : null;
  const resolvedCompany = companyRes.status === "exact" ? companyRes.company : null;

  if (unitRes.status === "many") {
    const labels = unitRes.candidates!.map((u, i) => `${i + 1}. ${u.label}`).join("\n");
    const { reply, latencyMs: redactMs } = await redactReply({
      plan,
      facts: [`Encontré varias unidades:\n${labels}\n\nDecime el número o la patente exacta.`],
      state,
      env: input.env,
      userMessage: input.message,
      lastAssistantReply,
    });
    const applied = applyCommanderState({
      state,
      plan,
      resolvedUnit: null,
      resolvedCompany,
      unitMany: unitRes.candidates,
      message: input.message,
      reply,
    });
    saveConversationStateV3(applied.state);
    const trace = buildTrace({
      turnInput: input,
      stateBefore,
      stateAfter: applied.state,
      plan,
      interpretMs,
      interpretRaw,
      interpretModel,
      redactMs,
      totalStart,
      inventory,
      interpretation,
      capabilityResults: [],
      validationOk: true,
      execFacts: [labels],
    });
    saveLastTraceV3(input.tenantId, input.phone, trace);
    return { reply, state: applied.state, trace };
  }

  plan = enrichPlanStripBareFleetDump(plan);

  const exec = await executeCapabilities({
    state,
    plan,
    env: input.env,
    fleetUnits,
    resolvedUnit,
    resolvedCompanyId: resolvedCompany?.id ?? null,
    message: input.message,
    messageId: input.messageId,
  });

  state = exec.state;
  const capabilityResults = mapExecResultsToStructured(exec.results);

  if (exec.results.some((r) => r.error === "no_unit")) {
    const skipNoUnitAsk =
      plan.conversationalAct === "greet" ||
      plan.responseGoal.purpose === "clarify" ||
      plan.parkedTurn != null;
    if (!skipNoUnitAsk) {
      const ask = exec.facts.find((f) => f.trim()) ?? "¿De qué unidad?";
      plan = {
        ...plan,
        conversationalAct: "ask",
        responseGoal: { purpose: "ask_missing", facts: exec.facts, nextQuestion: ask },
      };
    }
  }

  const { reply, latencyMs: redactMs } = await redactReply({
    plan,
    facts: exec.facts,
    state,
    env: input.env,
    userMessage: input.message,
    lastAssistantReply,
  });

  const applied = applyCommanderState({
    state,
    plan,
    resolvedUnit,
    resolvedCompany,
    message: input.message,
    reply,
  });

  let finalState = {
    ...applied.state,
    activeTask: state.activeTask ?? applied.state.activeTask,
    pendingWrite: state.pendingWrite ?? applied.state.pendingWrite,
    pendingEntity: state.pendingEntity ?? applied.state.pendingEntity,
    lastQuestion: state.lastQuestion ?? applied.state.lastQuestion,
    unit: state.unit ?? applied.state.unit,
    company: state.company ?? applied.state.company,
    conversationMetadata: {
      ...applied.state.conversationMetadata,
      ...state.conversationMetadata,
      runtimeNext: {
        promptVersion: RUNTIME_NEXT_PROMPT_VERSION,
        registryVersion: SERVICE_REGISTRY_VERSION,
      },
    },
  };

  if (decision.action === "keep_or_close") {
    const lq = lastQuestionForKeepOrClose(plan);
    if (lq) {
      finalState = { ...finalState, lastQuestion: lq };
    }
  }

  if (decision.action === "cancel") {
    finalState = {
      ...finalState,
      activeTask: null,
      pendingWrite: null,
      pendingEntity: null,
      lastQuestion: null,
    };
  }

  saveConversationStateV3(finalState);

  const trace = buildTrace({
    turnInput: input,
    stateBefore,
    stateAfter: finalState,
    plan,
    interpretMs,
    interpretRaw,
    interpretModel,
    redactMs,
    totalStart,
    inventory,
    interpretation,
    capabilityResults,
    validationOk: true,
    execFacts: exec.facts,
    execResults: exec.results,
    writeAttempt: exec.results.some((r) => r.writeAttempt),
    writeExecuted: exec.results.some((r) => r.writeExecuted),
    finalReply: reply,
  });
  saveLastTraceV3(input.tenantId, input.phone, trace);
  return { reply, state: finalState, trace };
}

function buildTrace(opts: {
  turnInput: ProcessConversationTurnInput;
  stateBefore: ConversationStateV3;
  stateAfter: ConversationStateV3;
  plan: TurnPlan;
  interpretMs: number;
  interpretRaw: unknown;
  interpretModel: string;
  redactMs: number;
  totalStart: number;
  inventory: ReturnType<typeof buildKnowledgeInventory>;
  interpretation: TurnInterpretation | null;
  capabilityResults: ReturnType<typeof mapExecResultsToStructured>;
  validationOk: boolean;
  execFacts?: string[];
  execResults?: Array<{ capability: string; writeAttempt?: boolean; writeExecuted?: boolean }>;
  writeAttempt?: boolean;
  writeExecuted?: boolean;
  finalReply?: string;
}): TurnTraceV3 & {
  runtimeNext: {
    interpretation: TurnInterpretation | null;
    inventory: ReturnType<typeof buildKnowledgeInventory>;
    capabilityResults: ReturnType<typeof mapExecResultsToStructured>;
  };
} {
  return {
    messageId: opts.turnInput.messageId,
    stateBefore: opts.stateBefore,
    commanderCalled: false,
    commanderRawOutput: opts.interpretRaw,
    turnPlan: opts.plan,
    validation: { ok: opts.validationOk, errors: [] },
    repairCalled: false,
    repairResult: null,
    entityResolution: {},
    capabilitiesRequested: opts.plan.requestedCapabilities,
    capabilitiesExecuted: opts.execResults?.map((r) => r.capability) ?? [],
    toolResults: opts.execResults ?? [],
    statePatch: {},
    stateAfter: opts.stateAfter,
    responseFacts: opts.execFacts ?? [],
    finalReply: opts.finalReply ?? "",
    writeAttempt: Boolean(opts.writeAttempt),
    writeExecuted: Boolean(opts.writeExecuted),
    latency: {
      commanderMs: opts.interpretMs,
      repairMs: 0,
      redactMs: opts.redactMs,
      totalMs: Date.now() - opts.totalStart,
    },
    promptVersion: RUNTIME_NEXT_PROMPT_VERSION,
    model: opts.interpretModel,
    at: new Date().toISOString(),
    runtimeNext: {
      interpretation: opts.interpretation,
      inventory: opts.inventory,
      capabilityResults: opts.capabilityResults,
    },
  };
}
