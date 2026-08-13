/**
 * Pipeline Commander V3 — aislado del path conversacional V2 (sin reutilizar ese conductor).
 */
import type { WaraUnidadEstado } from "../pilot/wara-types.js";
import { formatUnitLabel, toFleetUnitRef } from "../pilot/unit-fleet.js";
import { callCommander, repairCommanderPlan } from "./commander/call.js";
import { validateTurnPlan } from "./validate/validate-plan.js";
import {
  resolveCompanyReference,
  resolveUnitReference,
} from "./entities/resolve.js";
import { executeCapabilities } from "./execute/run-capabilities.js";
import { enrichPlanWithNaturalDatetime } from "./enrich/natural-datetime-plan.js";
import {
  enrichPlanForCompanyCapture,
  enrichPlanForGreetingCompanyGate,
} from "./enrich/company-capture.js";
import { enrichPlanForGreetingPolicy } from "./enrich/greeting-policy.js";
import { enrichPlanForExpectedFields } from "./enrich/expected-field-capture.js";
import { enrichPlanForCancelGuard } from "./enrich/cancel-guard.js";
import { enrichPlanForConfirmationOutcome } from "./enrich/confirmation-outcome.js";
import {
  enrichPlanForTaskSwitch,
  isSwitchingTask,
  stateForSwitchedTask,
} from "./enrich/task-switch.js";
import { applyCommanderState } from "./state/apply-patch.js";
import { redactReply } from "./reply/redact.js";
import {
  getConversationStateV3,
  saveConversationStateV3,
  saveLastTraceV3,
  createEmptyIfNeeded,
} from "./persistence/store-helpers.js";
import type { ConversationStateV3 } from "./types/state.js";
import type { CompanyRef } from "./types/refs.js";
import type { TurnTraceV3 } from "./observability/trace.js";
import { COMMANDER_V3_PROMPT_VERSION } from "./flags.js";
import type { TurnPlan } from "./types/turn-plan.js";
import type { UnitRef } from "./types/refs.js";
import { DEFAULT_TENANT_TZ } from "../pilot/semantic/natural-datetime.js";
import { DateTime } from "luxon";

export type RunCommanderTurnInput = {
  tenantId: string;
  phone: string;
  message: string;
  messageId: string;
  env: NodeJS.ProcessEnv;
  contacts?: Array<{ id: number; nombre: string; empresa: string }>;
  fleetUnits?: WaraUnidadEstado[];
  customerName?: string | null;
};

export type RunCommanderTurnResult = {
  reply: string;
  state: ConversationStateV3;
  trace: TurnTraceV3;
};

export async function runCommanderTurn(
  input: RunCommanderTurnInput,
): Promise<RunCommanderTurnResult> {
  const totalStart = Date.now();
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
      fleetCache: fleetUnits.map((u) => {
        const ref = toFleetUnitRef(u);
        return {
          movilId: u.movil_id,
          plate: u.patente ?? null,
          name: u.unidad ?? null,
          label: formatUnitLabel(u),
          odometer: u.odometro ?? null,
          hourmeter: u.horometro ?? null,
          ...(ref ? {} : {}),
        };
      }),
    };
  }

  const stateBefore = structuredClone(state);

  const commander = await callCommander({
    message: input.message,
    state,
    env: input.env,
  });

  let plan = commander.plan;
  let validation = validateTurnPlan(plan, state);
  let repairCalled = false;
  let repairResult: unknown = null;
  let repairMs = 0;

  if (!validation.ok) {
    repairCalled = true;
    const rStart = Date.now();
    const repaired = await repairCommanderPlan({
      originalMessage: input.message,
      previousPlan: commander.raw,
      validationErrors: validation.errors,
      state,
      env: input.env,
    });
    repairMs = Date.now() - rStart;
    repairResult = repaired.raw;
    plan = repaired.plan;
    validation = validateTurnPlan(plan, state);
  }

  if (!validation.ok || !plan) {
    const clarify = buildConflictClarify(validation.errors, state);
    const { reply, latencyMs: redactMs } = await redactReply({
      plan: plan ?? {
        reasoning: "Validación falló; pido aclaración puntual.",
        conversationalAct: "ask",
        requestedCapabilities: [],
        stateIntent: {
          preserveCompany: true,
          preserveUnit: true,
          preserveTask: true,
        },
        responseGoal: {
          purpose: "clarify",
          facts: [],
          nextQuestion: clarify,
        },
        confidence: 0.2,
      },
      facts: [],
      state,
      env: input.env,
      conflictClarify: clarify,
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
    const trace: TurnTraceV3 = {
      messageId: input.messageId,
      stateBefore,
      commanderCalled: true,
      commanderRawOutput: commander.raw,
      turnPlan: plan,
      validation: { ok: false, errors: validation.errors },
      repairCalled,
      repairResult,
      entityResolution: {},
      capabilitiesRequested: [],
      capabilitiesExecuted: [],
      toolResults: [],
      statePatch: {},
      stateAfter: after,
      responseFacts: [],
      finalReply: reply,
      writeAttempt: false,
      writeExecuted: false,
      latency: {
        commanderMs: commander.latencyMs,
        repairMs,
        redactMs,
        totalMs: Date.now() - totalStart,
      },
      promptVersion: COMMANDER_V3_PROMPT_VERSION,
      model: commander.model,
      at: new Date().toISOString(),
    };
    saveLastTraceV3(input.tenantId, input.phone, trace);
    return { reply, state: after, trace };
  }

  const localNow = DateTime.now()
    .setZone(DEFAULT_TENANT_TZ)
    .toFormat("yyyy-MM-dd'T'HH:mm:ss");
  plan = enrichPlanWithNaturalDatetime(plan, state, input.message, {
    timezone: DEFAULT_TENANT_TZ,
    localNow,
  });
  plan = enrichPlanForGreetingPolicy(plan, state, input.message);
  plan = enrichPlanForConfirmationOutcome(plan, state, input.message);
  plan = enrichPlanForTaskSwitch(plan, state);
  plan = enrichPlanForCancelGuard(plan, state, input.message);
  plan = enrichPlanForGreetingCompanyGate(plan, state);
  plan = enrichPlanForCompanyCapture(plan, state, input.message);
  plan = enrichPlanForExpectedFields(plan, state, input.message);

  // Switch: ejecutar el nuevo trámite sobre estado limpio (sin collected ajeno)
  if (isSwitchingTask(plan, state) && plan.task) {
    state = stateForSwitchedTask(state, plan.task);
  }

  // Medidor sin unidad: listar flota en el mismo turno (estructural, no semántico)
  const meterPrepare = plan.requestedCapabilities.some(
    (c) => c.name === "odometer.prepare" || c.name === "hourmeter.prepare",
  );
  const startsMeter =
    plan.task === "odometer" ||
    plan.task === "hourmeter" ||
    meterPrepare ||
    ((plan.conversationalAct === "start_task" || plan.taskAction === "start") &&
      (plan.task === "odometer" || plan.task === "hourmeter"));
  if (
    startsMeter &&
    !state.unit &&
    !plan.unitReference &&
    !plan.requestedCapabilities.some(
      (c) => c.name === "unit.search" || c.name === "unit.select",
    )
  ) {
    plan = {
      ...plan,
      requestedCapabilities: [
        ...plan.requestedCapabilities,
        { name: "unit.search", params: {} },
      ],
    };
  }

  // Ensure company selected for ops if only one contact
  if (!state.company && state.availableCompanies.length === 1) {
    state = { ...state, company: state.availableCompanies[0]! };
  }

  const unitRes = resolveUnitReference(plan.unitReference ?? null, state);
  const companyRes = resolveCompanyReference(plan.companyReference ?? null, state);

  const resolvedUnit = unitRes.status === "exact" ? unitRes.unit : null;
  const resolvedCompany =
    companyRes.status === "exact" ? companyRes.company : null;
  const unitMany = unitRes.status === "many" ? unitRes.candidates : undefined;

  // Auto-inject unit.select / company.select when resolved (solo si cambia)
  if (
    resolvedUnit &&
    resolvedUnit.movilId !== state.unit?.movilId &&
    !plan.requestedCapabilities.some((c) => c.name === "unit.select")
  ) {
    if (
      plan.unitReference ||
      state.pendingEntity?.type === "unit" ||
      state.lastQuestion?.expected === "unit" ||
      plan.conversationalAct === "continue_task"
    ) {
      plan = {
        ...plan,
        requestedCapabilities: [
          { name: "unit.select", params: { movilId: resolvedUnit.movilId } },
          ...plan.requestedCapabilities,
        ],
      };
    }
  }
  if (
    resolvedCompany &&
    resolvedCompany.id !== state.company?.id &&
    !plan.requestedCapabilities.some((c) => c.name === "company.select")
  ) {
    if (
      plan.companyReference ||
      state.pendingEntity?.type === "company" ||
      state.lastQuestion?.expected === "company"
    ) {
      plan = {
        ...plan,
        requestedCapabilities: [
          {
            name: "company.select",
            params: { companyId: resolvedCompany.id },
          },
          ...plan.requestedCapabilities,
        ],
      };
    }
  } else if (resolvedCompany) {
    plan = {
      ...plan,
      requestedCapabilities: plan.requestedCapabilities.map((c) =>
        c.name === "company.select" && !c.params?.companyId
          ? { ...c, params: { ...c.params, companyId: resolvedCompany.id } }
          : c,
      ),
    };
  }

  // No re-ejecutar select de la misma empresa/unidad ya activa
  plan = {
    ...plan,
    requestedCapabilities: plan.requestedCapabilities.filter((c) => {
      if (
        c.name === "company.select" &&
        state.company &&
        String(c.params?.companyId ?? resolvedCompany?.id ?? "") ===
          state.company.id
      ) {
        return false;
      }
      if (
        c.name === "unit.select" &&
        state.unit &&
        resolvedUnit &&
        state.unit.movilId === resolvedUnit.movilId
      ) {
        return false;
      }
      return true;
    }),
  };

  // Ambiguous → facts only, no tools that mutate write
  if (unitMany) {
    const labels = unitMany.map((u, i) => `${i + 1}. ${u.label}`).join("\n");
    const { reply, latencyMs: redactMs } = await redactReply({
      plan,
      facts: [
        `Encontré varias unidades:\n${labels}\n\nDecime el número o la patente exacta.`,
      ],
      state,
      env: input.env,
    });
    const applied = applyCommanderState({
      state,
      plan,
      resolvedUnit: null,
      resolvedCompany,
      unitMany,
      message: input.message,
      reply,
    });
    saveConversationStateV3(applied.state);
    const trace: TurnTraceV3 = {
      messageId: input.messageId,
      stateBefore,
      commanderCalled: true,
      commanderRawOutput: commander.raw,
      turnPlan: plan,
      validation: { ok: true, errors: [] },
      repairCalled,
      repairResult,
      entityResolution: { unit: unitRes, company: companyRes },
      capabilitiesRequested: plan.requestedCapabilities,
      capabilitiesExecuted: [],
      toolResults: [],
      statePatch: {},
      stateAfter: applied.state,
      responseFacts: [labels],
      finalReply: reply,
      writeAttempt: false,
      writeExecuted: false,
      latency: {
        commanderMs: commander.latencyMs,
        repairMs,
        redactMs,
        totalMs: Date.now() - totalStart,
      },
      promptVersion: COMMANDER_V3_PROMPT_VERSION,
      model: commander.model,
      at: new Date().toISOString(),
    };
    saveLastTraceV3(input.tenantId, input.phone, trace);
    return { reply, state: applied.state, trace };
  }

  const exec = await executeCapabilities({
    state,
    plan,
    env: input.env,
    fleetUnits,
    resolvedUnit,
    resolvedCompanyId: resolvedCompany?.id ?? null,
    message: input.message,
  });

  state = exec.state;

  const { reply, latencyMs: redactMs } = await redactReply({
    plan,
    facts: exec.facts,
    state,
    env: input.env,
  });

  const applied = applyCommanderState({
    state,
    plan,
    resolvedUnit,
    resolvedCompany,
    message: input.message,
    reply,
  });

  // Prefer execute state patches already on `state`; merge history from applied
  const finalState: ConversationStateV3 = {
    ...applied.state,
    // keep execute patches for pendingWrite/activeTask if apply didn't wipe them wrongly
    activeTask: state.activeTask ?? applied.state.activeTask,
    pendingWrite: state.pendingWrite,
    pendingEntity: state.pendingEntity ?? applied.state.pendingEntity,
    lastQuestion: state.lastQuestion ?? applied.state.lastQuestion,
    lastListing: state.lastListing ?? applied.state.lastListing,
    unit: state.unit ?? applied.state.unit,
    previousUnit: state.previousUnit ?? applied.state.previousUnit,
    company: state.company ?? applied.state.company,
  };

  saveConversationStateV3(finalState);

  const writeAttempt = exec.results.some((r) => r.writeAttempt);
  const writeExecuted = exec.results.some((r) => r.writeExecuted);

  const trace: TurnTraceV3 = {
    messageId: input.messageId,
    stateBefore,
    commanderCalled: true,
    commanderRawOutput: commander.raw,
    turnPlan: plan,
    validation: { ok: true, errors: [] },
    repairCalled,
    repairResult,
    entityResolution: { unit: unitRes, company: companyRes },
    capabilitiesRequested: plan.requestedCapabilities,
    capabilitiesExecuted: exec.results.map((r) => r.capability),
    toolResults: exec.results,
    statePatch: {},
    stateAfter: finalState,
    responseFacts: exec.facts,
    finalReply: reply,
    writeAttempt: Boolean(writeAttempt),
    writeExecuted: Boolean(writeExecuted),
    latency: {
      commanderMs: commander.latencyMs,
      repairMs,
      redactMs,
      totalMs: Date.now() - totalStart,
    },
    promptVersion: COMMANDER_V3_PROMPT_VERSION,
    model: commander.model,
    at: new Date().toISOString(),
  };
  saveLastTraceV3(input.tenantId, input.phone, trace);
  return { reply, state: finalState, trace };
}

function buildConflictClarify(errors: string[], state: ConversationStateV3): string {
  if (errors.includes("confirm_without_pending_write")) {
    return "No hay una operación pendiente para confirmar. ¿Qué trámite querés iniciar?";
  }
  if (errors.some((e) => e.startsWith("write_commit_without"))) {
    return "Para ejecutar eso necesito una confirmación explícita sobre el resumen pendiente.";
  }
  if (errors.includes("amend_vs_cancel_conflict") || errors.includes("cancel_vs_confirm_conflict")) {
    return "No me quedó claro si querés corregir un dato o cancelar el trámite. ¿Cuál de las dos?";
  }
  if (state.pendingWrite) {
    return `Hay una confirmación pendiente de ${state.pendingWrite.task}. ¿Confirmás con CONFIRMO o cancelamos?`;
  }
  if (state.pendingEntity?.type === "unit") {
    return "Necesito la patente o el número de la unidad para seguir.";
  }
  if (state.lastQuestion?.expected === "value") {
    return "Pasame el valor numérico para continuar.";
  }
  return "Necesito una aclaración puntual: ¿qué querés hacer exactamente con el trámite actual?";
}
