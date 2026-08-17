import type { WaraUnidadEstado } from "../pilot/wara-types.js";
import { formatUnitLabel } from "../pilot/unit-fleet.js";
import { validateTurnPlan } from "../commander-v3/validate/validate-plan.js";
import {
  resolveCompanyReference,
  resolveUnitReference,
} from "../commander-v3/entities/resolve.js";
import {
  stripMeterValueConfusedWithUnit,
} from "../commander-v3/execute/run-capabilities.js";
import { enrichPlanWithNaturalDatetime } from "../commander-v3/enrich/natural-datetime-plan.js";
import {
  KEEP_OR_CLOSE_PURPOSE,
  planFromParkedTurn,
} from "../commander-v3/enrich/open-task-hold.js";
import { composeReply, stripBareFleetSearchCaps } from "./compose/composer.js";
import { executeAuthorizedCapabilities } from "./execute/execute-authorized.js";
import { migrateV3ToVNext } from "./state/migrate.js";
import { vnextToV3 } from "./state/to-v3.js";
import { reconcileVNextAfterExecute } from "./state/reconcile.js";
import { reduceState, ensureFocusedTask } from "./state/reduce.js";
import type { ConversationStateVNext } from "./state/vnext-types.js";
import {
  applyStructuralExtensions,
  assertBridgeInvariants,
} from "./controller/bridge-guard.js";
import {
  getConversationStateV3,
  saveConversationStateV3,
  saveLastTraceV3,
  createEmptyIfNeeded,
} from "../commander-v3/persistence/store-helpers.js";
import type { ConversationStateV3 } from "../commander-v3/types/state.js";
import type { CompanyRef } from "../commander-v3/types/refs.js";
import type { TurnTraceV3 } from "../commander-v3/observability/trace.js";
import type { TurnPlan } from "../commander-v3/types/turn-plan.js";
import { DEFAULT_TENANT_TZ } from "../pilot/semantic/natural-datetime.js";
import { DateTime } from "luxon";
import { callInterpreter } from "./interpreter/call.js";
import type { InterpreterDiagnostic } from "./interpreter/diagnostics.js";
import { decideTurn, filterAuthorizedCapabilities } from "./controller/decide-turn.js";
import { applyOperationalParityBridge } from "./operational/parity-bridge.js";
import {
  planFromDecision,
} from "./controller/plan-from-decision.js";
import { mapExecResultsToStructured } from "./execute/adapt-results.js";
import {
  RUNTIME_NEXT_PROMPT_VERSION,
  SERVICE_REGISTRY_VERSION,
} from "./flags.js";
import { buildKnowledgeInventory } from "./registry/knowledge-inventory.js";
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

function persistVNext(vnext: ConversationStateVNext, tenantId: string, phone: string): ConversationStateV3 {
  const v3 = vnextToV3(vnext);
  saveConversationStateV3(v3);
  return v3;
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

  let vnext = migrateV3ToVNext(state);

  const fleetUnits = input.fleetUnits ?? [];
  if (fleetUnits.length) {
    vnext = {
      ...vnext,
      fleetCache: fleetUnits.map((u) => ({
        movilId: u.movil_id,
        plate: u.patente ?? null,
        name: u.unidad ?? null,
        label: formatUnitLabel(u),
        odometer: u.odometro ?? null,
        hourmeter: u.horometro ?? null,
      })),
    };
    state = { ...state, fleetCache: vnext.fleetCache };
  }

  const stateBefore = structuredClone(state);
  const lastAssistantReply =
    [...state.recentTurns].reverse().find((t) => t.role === "assistant")?.text ?? null;

  let interpretMs = 0;
  let interpretRaw: unknown = null;
  let interpretModel = "";
  let interpretDiagnostic: InterpreterDiagnostic | null = null;
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
    interpretDiagnostic = ir.diagnostic;
    interpretation = ir.interpretation;
  }

  if (!interpretation) {
    const failKind = interpretDiagnostic?.finalFailureKind ?? "unknown_error";
    const reply = "No entendí bien. ¿Qué necesitás hacer?";
    vnext = reduceState({
      state: vnext,
      decision: {
        action: "clarify",
        reasoning: `Intérprete falló (${failKind}).`,
        authorizedCapabilities: [],
        conversationalAct: "ask",
        stateIntent: { preserveCompany: true, preserveUnit: true, preserveTask: true },
        responseGoal: { purpose: "clarify", facts: [], nextQuestion: reply },
        confidence: 0.2,
        interpretationSummary: "",
      },
      reply,
      userMessage: input.message,
    });
    const after = persistVNext(vnext, input.tenantId, input.phone);
    const trace = buildTrace({
      turnInput: input,
      stateBefore,
      stateAfter: after,
      plan: {
        reasoning: "fallback",
        conversationalAct: "ask",
        requestedCapabilities: [],
        stateIntent: { preserveCompany: true, preserveUnit: true, preserveTask: true },
        responseGoal: { purpose: "clarify", facts: [] },
        confidence: 0.2,
      },
      interpretMs,
      interpretRaw,
      interpretModel,
      redactMs: 0,
      totalStart,
      inventory,
      interpretation: null,
      capabilityResults: [],
      validationOk: false,
      interpretDiagnostic,
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

  const parity = applyOperationalParityBridge({
    decision,
    interpretation,
    state,
    vnext,
    message: input.message,
  });
  decision = parity.decision;
  if (parity.operationalFacts.length && parity.expectedCapture.eligible) {
    decision = {
      ...decision,
      responseGoal: {
        ...decision.responseGoal,
        facts: [
          ...parity.operationalFacts.map((f) => f.text),
          ...(decision.responseGoal.facts ?? []),
        ],
      },
    };
  }

  let plan = planFromDecision({ decision, interpretation });
  let validation = validateTurnPlan(plan, state);

  if (!validation.ok) {
    const reply = "Necesito una aclaración para seguir.";
    vnext = reduceState({
      state: vnext,
      decision: {
        action: "clarify",
        reasoning: validation.errors.join("; "),
        authorizedCapabilities: [],
        conversationalAct: "ask",
        stateIntent: { preserveCompany: true, preserveUnit: true, preserveTask: true },
        responseGoal: { purpose: "clarify", facts: [], nextQuestion: reply },
        confidence: 0.3,
        interpretationSummary: interpretation.normalizedMeaning,
      },
      reply,
      userMessage: input.message,
    });
    const after = persistVNext(vnext, input.tenantId, input.phone);
    const trace = buildTrace({
      turnInput: input,
      stateBefore,
      stateAfter: after,
      plan: clarifyPlanStub(),
      interpretMs,
      interpretRaw,
      interpretModel,
      redactMs: 0,
      totalStart,
      inventory,
      interpretation,
      capabilityResults: [],
      validationOk: false,
      interpretDiagnostic,
    });
    saveLastTraceV3(input.tenantId, input.phone, trace);
    return { reply, state: after, trace };
  }

  const localNow = DateTime.now().setZone(DEFAULT_TENANT_TZ).toFormat("yyyy-MM-dd'T'HH:mm:ss");
  plan = enrichPlanWithNaturalDatetime(plan, state, input.message, {
    timezone: DEFAULT_TENANT_TZ,
    localNow,
  });

  if (decision.task && decision.action === "execute") {
    vnext = ensureFocusedTask(vnext, decision.task);
  }

  if (vnext.expectedInput?.purpose === KEEP_OR_CLOSE_PURPOSE) {
    if (decision.action === "cancel") {
      const parked = vnext.conversationMetadata.parkedTurn ?? null;
      vnext = {
        ...vnext,
        tasks: vnext.tasks.filter((t) => t.id !== vnext.focusedTaskId),
        focusedTaskId: null,
        expectedInput: null,
        pendingOperation: null,
        conversationMetadata: { ...vnext.conversationMetadata, parkedTurn: null },
      };
      if (parked) {
        plan = planFromParkedTurn(parked, plan);
      }
    } else if (decision.action === "resume") {
      vnext = {
        ...vnext,
        conversationMetadata: { ...vnext.conversationMetadata, parkedTurn: null },
      };
    }
  }

  if (
    (plan.task === "odometer" || plan.task === "hourmeter") &&
    plan.suppliedFields?.value != null
  ) {
    const cleaned = stripMeterValueConfusedWithUnit({
      value: plan.suppliedFields.value,
      unit: vnext.unit,
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

  const planBeforeStructural = plan;
  plan = applyStructuralExtensions(plan, decision);
  const bridgeCheck = assertBridgeInvariants(decision, planBeforeStructural, plan);
  if (!bridgeCheck.ok) {
    plan = planBeforeStructural;
  }

  if (!vnext.fleetCache.length) {
    plan = {
      ...plan,
      requestedCapabilities: plan.requestedCapabilities.filter((c) => c.name !== "unit.search"),
    };
  }

  if (!vnext.company && vnext.availableCompanies.length === 1) {
    vnext = { ...vnext, company: vnext.availableCompanies[0]! };
    state = { ...state, company: vnext.company };
  }

  state = vnextToV3(vnext);
  const unitRes = resolveUnitReference(plan.unitReference ?? null, state);
  const companyRes = resolveCompanyReference(plan.companyReference ?? null, state);
  const resolvedUnit = unitRes.status === "exact" ? unitRes.unit : null;
  const resolvedCompany = companyRes.status === "exact" ? companyRes.company : null;

  const expectedUnitField =
    state.lastQuestion?.expected === "unit" || vnext.expectedInput?.field === "unit";

  if (
    unitRes.status === "not_found" &&
    parity.expectedCapture.eligible &&
    expectedUnitField &&
    plan.unitReference
  ) {
    const facts =
      parity.operationalFacts.length > 0
        ? parity.operationalFacts.map((f) => f.text)
        : [
            `No encontré una unidad con el identificador «${unitRes.query ?? input.message.trim()}». ¿Podés repetir el código o la patente?`,
          ];
    const composed = await composeReply({
      decision: { ...decision, action: "clarify", conversationalAct: "ask" },
      interpretation,
      facts,
      capabilityResults: [],
      state: vnext,
      customerName: input.customerName,
      env: input.env,
      userMessage: input.message,
      lastAssistantReply,
    });
    const reply = composed.reply;
    vnext = reduceState({
      state: vnext,
      decision: { ...decision, action: "clarify" },
      reply,
      userMessage: input.message,
      resolvedCompany,
    });
    const after = persistVNext(vnext, input.tenantId, input.phone);
    const trace = buildTrace({
      turnInput: input,
      stateBefore,
      stateAfter: after,
      plan,
      interpretMs,
      interpretRaw,
      interpretModel,
      redactMs: composed.latencyMs,
      totalStart,
      inventory,
      interpretation,
      capabilityResults: [],
      validationOk: true,
      execFacts: facts,
      finalReply: reply,
      interpretDiagnostic,
      operationalParity: parity,
    });
    saveLastTraceV3(input.tenantId, input.phone, trace);
    return { reply, state: after, trace };
  }

  if (unitRes.status === "many") {
    const labels = unitRes.candidates!.map((u, i) => `${i + 1}. ${u.label}`).join("\n");
    const facts = [`Encontré varias unidades:\n${labels}\n\nDecime el número o la patente exacta.`];
    const composed = await composeReply({
      decision,
      interpretation,
      facts,
      capabilityResults: [],
      state: vnext,
      customerName: input.customerName,
      env: input.env,
      userMessage: input.message,
      lastAssistantReply,
    });
    const reply = composed.reply;
    vnext = reduceState({
      state: vnext,
      decision,
      reply,
      userMessage: input.message,
      resolvedCompany,
      unitListing: {
        kind: "search",
        page: 1,
        pageSize: unitRes.candidates!.length,
        totalCount: unitRes.candidates!.length,
        items: unitRes.candidates!.map((u, i) => ({
          index: i + 1,
          label: u.label,
          movilId: u.movilId,
        })),
        fetchedAt: new Date().toISOString(),
      },
    });
    const after = persistVNext(vnext, input.tenantId, input.phone);
    const trace = buildTrace({
      turnInput: input,
      stateBefore,
      stateAfter: after,
      plan,
      interpretMs,
      interpretRaw,
      interpretModel,
      redactMs: composed.latencyMs,
      totalStart,
      inventory,
      interpretation,
      capabilityResults: [],
      validationOk: true,
      execFacts: facts,
      finalReply: reply,
      interpretDiagnostic,
      operationalParity: parity,
    });
    saveLastTraceV3(input.tenantId, input.phone, trace);
    return { reply, state: after, trace };
  }

  if (
    decision.action === "respond" ||
    decision.action === "clarify" ||
    (decision.action === "cancel" && decision.authorizedCapabilities.length === 0)
  ) {
    const composed = await composeReply({
      decision,
      interpretation,
      facts: decision.responseGoal.facts ?? [],
      capabilityResults: [],
      state: vnext,
      customerName: input.customerName,
      env: input.env,
      userMessage: input.message,
      lastAssistantReply,
    });
    const reply = composed.reply;
    vnext = reduceState({
      state: vnext,
      decision,
      reply,
      userMessage: input.message,
      resolvedUnit,
      resolvedCompany,
    });
    vnext = {
      ...vnext,
      conversationMetadata: {
        ...vnext.conversationMetadata,
        runtimeNext: {
          promptVersion: RUNTIME_NEXT_PROMPT_VERSION,
          registryVersion: SERVICE_REGISTRY_VERSION,
        },
      },
    };
    const after = persistVNext(vnext, input.tenantId, input.phone);
    const trace = buildTrace({
      turnInput: input,
      stateBefore,
      stateAfter: after,
      plan,
      interpretMs,
      interpretRaw,
      interpretModel,
      redactMs: composed.latencyMs,
      totalStart,
      inventory,
      interpretation,
      capabilityResults: [],
      validationOk: true,
      finalReply: reply,
      interpretDiagnostic,
      operationalParity: parity,
    });
    saveLastTraceV3(input.tenantId, input.phone, trace);
    return { reply, state: after, trace };
  }

  plan = {
    ...plan,
    requestedCapabilities: stripBareFleetSearchCaps(
      plan.requestedCapabilities,
      plan.task ?? decision.task ?? null,
    ),
  };

  const authorizedNames = plan.requestedCapabilities.map((c) => c.name);
  const exec = await executeAuthorizedCapabilities({
    state,
    plan,
    authorizedCapabilityNames: authorizedNames,
    env: input.env,
    fleetUnits,
    resolvedUnit,
    resolvedCompanyId: resolvedCompany?.id ?? null,
    message: input.message,
    messageId: input.messageId,
  });

  if (exec.capViolation) {
    const reply = "No pude ejecutar eso con seguridad. ¿Me lo repetís en una línea?";
    vnext = reduceState({
      state: vnext,
      decision: {
        ...decision,
        action: "clarify",
        responseGoal: { purpose: "clarify", facts: [], nextQuestion: reply },
      },
      reply,
      userMessage: input.message,
    });
    const after = persistVNext(vnext, input.tenantId, input.phone);
    const trace = buildTrace({
      turnInput: input,
      stateBefore,
      stateAfter: after,
      plan,
      interpretMs,
      interpretRaw,
      interpretModel,
      redactMs: 0,
      totalStart,
      inventory,
      interpretation,
      capabilityResults: [],
      validationOk: true,
      capViolation: exec.capViolation,
      finalReply: reply,
      interpretDiagnostic,
      operationalParity: parity,
    });
    saveLastTraceV3(input.tenantId, input.phone, trace);
    return { reply, state: after, trace };
  }

  vnext = reconcileVNextAfterExecute(vnext, exec.state);
  const capabilityResults = mapExecResultsToStructured(exec.results);

  const composed = await composeReply({
    decision,
    interpretation,
    facts: exec.facts,
    capabilityResults,
    state: vnext,
    customerName: input.customerName,
    env: input.env,
    userMessage: input.message,
    lastAssistantReply,
  });
  const reply = composed.reply;

  vnext = reduceState({
    state: vnext,
    decision,
    reply,
    userMessage: input.message,
    resolvedUnit,
    resolvedCompany,
    capabilityResults,
  });
  vnext = {
    ...vnext,
    conversationMetadata: {
      ...vnext.conversationMetadata,
      runtimeNext: {
        promptVersion: RUNTIME_NEXT_PROMPT_VERSION,
        registryVersion: SERVICE_REGISTRY_VERSION,
      },
    },
  };

  const after = persistVNext(vnext, input.tenantId, input.phone);

  const trace = buildTrace({
    turnInput: input,
    stateBefore,
    stateAfter: after,
    plan,
    interpretMs,
    interpretRaw,
    interpretModel,
    redactMs: composed.latencyMs,
    totalStart,
    inventory,
    interpretation,
    capabilityResults,
    validationOk: true,
    execFacts: exec.facts,
    execResults: exec.results,
    writeAttempt: exec.results.some((r) => r.writeAttempt),
    writeExecuted: exec.results.some((r) => r.writeExecuted),
    authorizedCapabilities: exec.authorizedCapabilities,
    executedCapabilities: exec.executedCapabilities,
    finalReply: reply,
    interpretDiagnostic,
    operationalParity: parity,
  });
  saveLastTraceV3(input.tenantId, input.phone, trace);
  return { reply, state: after, trace };
}

function clarifyPlanStub(): TurnPlan {
  return {
    reasoning: "clarify",
    conversationalAct: "ask",
    requestedCapabilities: [],
    stateIntent: { preserveCompany: true, preserveUnit: true, preserveTask: true },
    responseGoal: { purpose: "clarify", facts: [] },
    confidence: 0.2,
  };
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
  capViolation?: string | null;
  authorizedCapabilities?: string[];
  executedCapabilities?: string[];
  interpretDiagnostic?: InterpreterDiagnostic | null;
  operationalParity?: ReturnType<typeof applyOperationalParityBridge>;
}): TurnTraceV3 & {
  runtimeNext: {
    interpretation: TurnInterpretation | null;
    inventory: ReturnType<typeof buildKnowledgeInventory>;
    capabilityResults: ReturnType<typeof mapExecResultsToStructured>;
    authorizedCapabilities?: string[];
    executedCapabilities?: string[];
    capViolation?: string | null;
    interpreterDiagnostic?: InterpreterDiagnostic | null;
    operationalParity?: ReturnType<typeof applyOperationalParityBridge>;
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
      authorizedCapabilities: opts.authorizedCapabilities,
      executedCapabilities: opts.executedCapabilities,
      capViolation: opts.capViolation ?? null,
      interpreterDiagnostic: opts.interpretDiagnostic ?? null,
      operationalParity: opts.operationalParity,
    },
  };
}
