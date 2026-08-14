/**
 * Pipeline Commander V3 — aislado del path conversacional V2 (sin reutilizar ese conductor).
 */
import { randomUUID, createHash } from "node:crypto";
import type { WaraUnidadEstado } from "../pilot/wara-types.js";
import { formatUnitLabel, toFleetUnitRef, extractUnitNameCode } from "../pilot/unit-fleet.js";
import { callCommander, repairCommanderPlan } from "./commander/call.js";
import { validateTurnPlan } from "./validate/validate-plan.js";
import {
  isExplicitUnitReference,
  resolveCompanyReference,
  resolveUnitReference,
} from "./entities/resolve.js";
import { executeCapabilities, stripMeterValueConfusedWithUnit } from "./execute/run-capabilities.js";
import { enrichPlanWithNaturalDatetime } from "./enrich/natural-datetime-plan.js";
import {
  enrichPlanForCompanyCapture,
  enrichPlanForGreetingCompanyGate,
} from "./enrich/company-capture.js";
import { enrichPlanForCompanyChange } from "./enrich/company-change.js";
import { enrichPlanForCompanyOpsGate } from "./enrich/company-ops-gate.js";
import { enrichPlanForGreetingPolicy } from "./enrich/greeting-policy.js";
import { enrichPlanForSoftClose } from "./enrich/soft-close.js";
import { enrichPlanForOpenConsult } from "./enrich/open-consult.js";
import { enrichPlanForConversationClose } from "./enrich/conversation-close.js";
import {
  enrichPlanForExpectedFields,
  enrichPlanForMeterValueFallback,
} from "./enrich/expected-field-capture.js";
import { enrichPlanForMeterUnitInMessage } from "./enrich/meter-unit-from-message.js";
import {
  enrichPlanForFleetSearchQuery,
  enrichPlanForGpsUnitInMessage,
  enrichPlanPromoteGpsFromReasoning,
  extractFleetFilterHint,
} from "./enrich/gps-unit-from-message.js";
import { enrichPlanForCancelGuard } from "./enrich/cancel-guard.js";
import {
  enrichPlanForConfirmationOutcome,
  isConfirmationReject,
  isUnequivocalWriteConfirm,
} from "./enrich/confirmation-outcome.js";
import {
  alternateTaskWhileConfirmPending,
  enrichPlanForPendingConfirmSwitch,
} from "./enrich/pending-confirm-switch.js";
import {
  enrichPlanForIdlePendingClarifyAnswer,
  enrichPlanForIdlePendingConfirm,
} from "./enrich/idle-pending-confirm.js";
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
import { getCapability } from "./capabilities/catalog.js";
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

  // Si se perdió pendingWrite pero seguimos en confirmación de certificado, reconstruir.
  if (
    !state.pendingWrite &&
    state.lastQuestion?.expected === "confirmation" &&
    state.activeTask?.type === "certificate" &&
    state.unit &&
    isUnequivocalWriteConfirm(input.message)
  ) {
    const payload = {
      task: "certificate",
      movilId: state.unit.movilId,
      plate: state.unit.plate,
      company: state.company?.name ?? null,
    };
    state = {
      ...state,
      pendingWrite: {
        operationId: `cert_rec_${Date.now().toString(36)}`,
        version: 1,
        payloadHash: createHash("sha256")
          .update(JSON.stringify(payload))
          .digest("hex")
          .slice(0, 32),
        task: "certificate",
        summary: payload,
      },
      activeTask: {
        ...state.activeTask,
        status: "awaiting_confirmation",
      },
    };
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

  // Confirmación pendiente: CONFIRMO / CANCELAR / switch a otro trámite ANTES de validate.
  // Si no, el LLM re-pide certificate.prepare o mete issue → loop de CONFIRMO.
  if (
    plan &&
    (state.pendingWrite || state.lastQuestion?.expected === "confirmation")
  ) {
    plan = enrichPlanForConfirmationOutcome(plan, state, input.message);
    plan = enrichPlanForPendingConfirmSwitch(plan, state, input.message);
    plan = enrichPlanForIdlePendingConfirm(plan, state, input.message);
    plan = enrichPlanForIdlePendingClarifyAnswer(plan, state, input.message);
    if (plan.conversationalAct === "confirm_write") {
      plan = {
        ...plan,
        requestedCapabilities: plan.requestedCapabilities.filter((c) => {
          const def = getCapability(c.name);
          return !def || def.kind !== "write_commit";
        }),
      };
    }
  }

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
    if (
      plan &&
      (state.pendingWrite || state.lastQuestion?.expected === "confirmation")
    ) {
      plan = enrichPlanForConfirmationOutcome(plan, state, input.message);
      plan = enrichPlanForPendingConfirmSwitch(plan, state, input.message);
      plan = enrichPlanForIdlePendingConfirm(plan, state, input.message);
      plan = enrichPlanForIdlePendingClarifyAnswer(plan, state, input.message);
      if (plan.conversationalAct === "confirm_write") {
        plan = {
          ...plan,
          requestedCapabilities: plan.requestedCapabilities.filter((c) => {
            const def = getCapability(c.name);
            return !def || def.kind !== "write_commit";
          }),
        };
      }
    }
    validation = validateTurnPlan(plan, state);
  }

  const localNow = DateTime.now()
    .setZone(DEFAULT_TENANT_TZ)
    .toFormat("yyyy-MM-dd'T'HH:mm:ss");
  const dtOpts = { timezone: DEFAULT_TENANT_TZ, localNow };

  // Si el plan LLM falla pero hay campo esperado capturable (ej. "129556" con expected=value),
  // recuperar sin pedir de nuevo el número.
  if (!validation.ok || !plan) {
    // CONFIRMO / CANCELAR pendientes: stub determinístico (no depender del LLM).
    if (
      state.pendingWrite ||
      state.lastQuestion?.expected === "confirmation"
    ) {
      if (isUnequivocalWriteConfirm(input.message)) {
        plan = {
          reasoning: "CONFIRMO inequívoco con pendingWrite: confirm_write.",
          conversationalAct: "confirm_write",
          taskAction: "confirm",
          requestedCapabilities: [],
          stateIntent: {
            preserveCompany: true,
            preserveUnit: true,
            preserveTask: true,
          },
          responseGoal: {
            purpose: "confirm_write",
            facts: [],
            nextQuestion: null,
          },
          confidence: 1,
        };
        validation = validateTurnPlan(plan, state);
      } else if (isConfirmationReject(input.message)) {
        plan = enrichPlanForConfirmationOutcome(
          {
            reasoning: "Rechazo de confirmación: cancel_task.",
            conversationalAct: "inform",
            requestedCapabilities: [],
            stateIntent: {
              preserveCompany: true,
              preserveUnit: true,
              preserveTask: false,
            },
            responseGoal: { purpose: "inform", facts: [], nextQuestion: null },
            confidence: 1,
          },
          state,
          input.message,
        );
        validation = validateTurnPlan(plan, state);
      } else {
        const alt = alternateTaskWhileConfirmPending(input.message, state);
        if (alt) {
          const prep =
            alt === "odometer"
              ? "odometer.prepare"
              : alt === "hourmeter"
                ? "hourmeter.prepare"
                : alt === "certificate"
                  ? "certificate.prepare"
                  : alt === "maintenance"
                    ? "maintenance.prepare"
                    : alt === "gps"
                      ? "gps.get_status"
                      : null;
          plan = {
            reasoning: `Switch stub: confirmación pendiente y el usuario pidió ${alt}.`,
            conversationalAct: "switch_task",
            task: alt,
            taskAction: "switch",
            requestedCapabilities: prep ? [{ name: prep, params: {} }] : [],
            stateIntent: {
              preserveCompany: true,
              preserveUnit: true,
              preserveTask: true,
            },
            responseGoal: {
              purpose: "ask_missing",
              facts: [],
              nextQuestion: null,
            },
            confidence: 1,
          };
          validation = validateTurnPlan(plan, state);
        }
      }
    }
  }

  if (!validation.ok || !plan) {
    const recovered = tryRecoverExpectedFieldPlan(
      state,
      input.message,
      dtOpts,
    );
    if (recovered) {
      plan = recovered;
      validation = validateTurnPlan(plan, state);
    }
  }

  if (!validation.ok || !plan) {
    const gpsRecovered = tryRecoverGpsPlan(state, input.message);
    if (gpsRecovered) {
      plan = gpsRecovered;
      validation = validateTurnPlan(plan, state);
    }
  }

  if (!validation.ok || !plan) {
    const meterRecovered = tryRecoverMeterStartPlan(state, input.message);
    if (meterRecovered) {
      plan = meterRecovered;
      validation = validateTurnPlan(plan, state);
    }
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

  plan = enrichPlanWithNaturalDatetime(plan, state, input.message, dtOpts);
  plan = enrichPlanForGreetingPolicy(plan, state, input.message);
  plan = enrichPlanForSoftClose(plan, state, input.message);
  plan = enrichPlanForOpenConsult(plan, state, input.message);
  plan = enrichPlanForConversationClose(plan, state, input.message);
  plan = enrichPlanForConfirmationOutcome(plan, state, input.message);
  // Campos esperados ANTES del switch: un "900078" es el km, no un trámite nuevo.
  plan = enrichPlanForExpectedFields(plan, state, input.message);
  plan = enrichPlanForMeterValueFallback(plan, state, input.message);
  plan = enrichPlanForTaskSwitch(plan, state);
  plan = enrichPlanForCancelGuard(plan, state, input.message);
  plan = enrichPlanForCompanyChange(plan, state, input.message);
  plan = enrichPlanForGreetingCompanyGate(plan, state);
  plan = enrichPlanForCompanyCapture(plan, state, input.message);
  plan = enrichPlanForPendingConfirmSwitch(plan, state, input.message);
  plan = enrichPlanForIdlePendingConfirm(plan, state, input.message);
  plan = enrichPlanForIdlePendingClarifyAnswer(plan, state, input.message);
  plan = enrichPlanForMeterUnitInMessage(plan, state, input.message);
  plan = enrichPlanPromoteGpsFromReasoning(plan, state);
  plan = enrichPlanForGpsUnitInMessage(plan, state, input.message);
  plan = enrichPlanForFleetSearchQuery(plan, state, input.message);

  // Mid odómetro/horómetro: nunca GPS/unit_query hijack; seguir pidiendo km/fecha.
  // Excepciones: cancel, switch real a otro trámite, pregunta lateral (empresa), cambio de unidad.
  if (
    (state.activeTask?.type === "odometer" ||
      state.activeTask?.type === "hourmeter") &&
    state.activeTask.status === "collecting" &&
    !state.pendingWrite
  ) {
    const meter = state.activeTask.type;
    const prep = meter === "hourmeter" ? "hourmeter.prepare" : "odometer.prepare";
    const switchTarget = plan.task;
    const realOpsSwitch =
      (plan.conversationalAct === "switch_task" ||
        plan.taskAction === "switch" ||
        plan.conversationalAct === "start_task") &&
      switchTarget &&
      switchTarget !== meter &&
      (switchTarget === "certificate" ||
        switchTarget === "gps" ||
        switchTarget === "maintenance" ||
        switchTarget === "human_handoff" ||
        switchTarget === "odometer" ||
        switchTarget === "hourmeter");
    const answeringField =
      state.lastQuestion?.expected === "value" ||
      state.lastQuestion?.expected === "date" ||
      state.lastQuestion?.expected === "time" ||
      /^\d+(?:[.,]\d+)?$/.test(input.message.trim());
    const unitOverride = Boolean(plan.unitReference);
    const lateralOk =
      plan.conversationalAct === "answer_lateral" ||
      plan.conversationalAct === "farewell" ||
      (plan.conversationalAct === "inform" &&
        !plan.requestedCapabilities.some(
          (c) =>
            c.name.startsWith("odometer") ||
            c.name.startsWith("hourmeter") ||
            c.name === "unit.search",
        ) &&
        !answeringField &&
        !unitOverride);
    const keepSwitch = Boolean(realOpsSwitch) && !answeringField;
    const scrubbedFacts = (plan.responseGoal.facts ?? []).filter(
      (f) => !/Dejamos pendiente/i.test(f),
    );

    // Cambio explícito de unidad mid-odo: soltar la unidad vieja para resolver la nueva.
    if (unitOverride && state.unit) {
      state = { ...state, previousUnit: state.unit, unit: null };
    }

    if (!keepSwitch && !lateralOk) {
      plan = {
        ...plan,
        task: meter,
        conversationalAct:
          plan.conversationalAct === "cancel_task"
            ? "cancel_task"
            : "continue_task",
        taskAction:
          plan.taskAction === "cancel" ? "cancel" : "continue",
        responseGoal: {
          ...plan.responseGoal,
          purpose: "ask_missing",
          facts: scrubbedFacts,
        },
        requestedCapabilities: [
          ...plan.requestedCapabilities.filter(
            (c) =>
              c.name !== "gps.get_status" &&
              c.name !== "unit.search" &&
              c.name !== "domain.answer",
          ),
          ...(plan.requestedCapabilities.some((c) => c.name === prep)
            ? []
            : [{ name: prep, params: {} }]),
        ],
      };
    } else if (keepSwitch) {
      plan = {
        ...plan,
        task: switchTarget!,
        conversationalAct: "switch_task",
        taskAction: "switch",
      };
    }
  }

  // Mid mantenimiento: el detalle (ej. "Del GPS") NUNCA es gps.get_status.
  if (
    state.activeTask?.type === "maintenance" &&
    state.activeTask.status === "collecting" &&
    !state.pendingWrite
  ) {
    const answeringDetail =
      state.lastQuestion?.expected === "free_text" ||
      state.lastQuestion?.purpose === "maintenance_detail" ||
      state.lastQuestion?.expected === "unit" ||
      Boolean(plan.suppliedFields?.detail);
    const switchTarget = plan.task;
    const realOpsSwitch =
      (plan.conversationalAct === "switch_task" ||
        plan.taskAction === "switch" ||
        plan.conversationalAct === "start_task") &&
      switchTarget &&
      switchTarget !== "maintenance" &&
      (switchTarget === "certificate" ||
        switchTarget === "gps" ||
        switchTarget === "odometer" ||
        switchTarget === "hourmeter" ||
        switchTarget === "human_handoff");
    // "Del GPS" / texto corto mientras pedimos detalle ≠ switch a GPS.
    const keepSwitch =
      Boolean(realOpsSwitch) &&
      !answeringDetail &&
      state.lastQuestion?.expected !== "free_text";
    const lateralOk =
      plan.conversationalAct === "farewell" ||
      plan.conversationalAct === "cancel_task";

    if (!keepSwitch && !lateralOk) {
      const detail =
        (typeof plan.suppliedFields?.detail === "string"
          ? plan.suppliedFields.detail
          : null) ??
        (answeringDetail &&
        state.lastQuestion?.expected === "free_text" &&
        input.message.trim()
          ? input.message.trim()
          : null);
      plan = {
        ...plan,
        task: "maintenance",
        conversationalAct:
          plan.conversationalAct === "cancel_task"
            ? "cancel_task"
            : "continue_task",
        taskAction:
          plan.taskAction === "cancel" ? "cancel" : "continue",
        suppliedFields: {
          ...(plan.suppliedFields ?? {}),
          ...(detail ? { detail } : {}),
        },
        responseGoal: {
          purpose: "ask_missing",
          facts: (plan.responseGoal.facts ?? []).filter(
            (f) =>
              !/Dejamos pendiente|aclaraci[oó]n puntual|tr[aá]mite actual/i.test(
                f,
              ),
          ),
          nextQuestion: null,
        },
        requestedCapabilities: [
          ...plan.requestedCapabilities.filter(
            (c) =>
              c.name !== "gps.get_status" &&
              c.name !== "unit.search" &&
              c.name !== "domain.answer" &&
              c.name !== "certificate.prepare",
          ),
          ...(plan.requestedCapabilities.some(
            (c) => c.name === "maintenance.prepare",
          )
            ? []
            : [{ name: "maintenance.prepare", params: {} }]),
        ],
        reasoning:
          (plan.reasoning ? `${plan.reasoning} ` : "") +
          "Mid-mantenimiento: mantengo maintenance.prepare (no GPS).",
      };
    }
  }

  // LLM a veces marca switch_task sin trámite previo → no debe pisar el prepare.
  if (
    (plan.conversationalAct === "switch_task" || plan.taskAction === "switch") &&
    !isSwitchingTask(plan, state)
  ) {
    plan = {
      ...plan,
      conversationalAct: "start_task",
      taskAction: "start",
      reasoning:
        (plan.reasoning ? `${plan.reasoning} ` : "") +
        "No había trámite previo que suspender: switch_task → start_task.",
    };
  }

  // Switch: ejecutar el nuevo trámite sobre estado limpio (sin collected ajeno)
  if (isSwitchingTask(plan, state) && plan.task) {
    state = stateForSwitchedTask(state, plan.task);
  }

  // Nunca tomar el código de unidad como km/hs antes de execute.
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
      const fields = { ...(plan.suppliedFields ?? {}) };
      delete fields.value;
      plan = {
        ...plan,
        suppliedFields: fields,
        reasoning:
          (plan.reasoning ? `${plan.reasoning} ` : "") +
          "Quité suppliedFields.value: era el código/ref de unidad, no el medidor.",
      };
    }
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

  // unit_query ⇒ unit.search (contrato de ejecución; el LLM no puede omitir la tool)
  if (
    plan.task === "unit_query" &&
    !plan.requestedCapabilities.some((c) => c.name === "unit.search")
  ) {
    plan = {
      ...plan,
      requestedCapabilities: [
        { name: "unit.search", params: {} },
        ...plan.requestedCapabilities,
      ],
    };
  }
  if (
    plan.requestedCapabilities.some((c) => c.name === "unit.search") &&
    plan.task == null
  ) {
    plan = { ...plan, task: "unit_query" };
  }

  // Tras reinyectar unit.search: si era reapertura idle, preferir menú abierto.
  plan = enrichPlanForOpenConsult(plan, state, input.message);

  // Trámites de escritura: si el LLM eligió el task, asegurar *.prepare
  const ensurePrepareFor = (
    task: "odometer" | "hourmeter" | "certificate",
    cap: string,
  ) => {
    if (
      plan.task === task &&
      !plan.requestedCapabilities.some((c) => c.name === cap)
    ) {
      plan = {
        ...plan,
        requestedCapabilities: [
          ...plan.requestedCapabilities,
          { name: cap, params: {} },
        ],
      };
    }
  };
  ensurePrepareFor("odometer", "odometer.prepare");
  ensurePrepareFor("hourmeter", "hourmeter.prepare");
  ensurePrepareFor("certificate", "certificate.prepare");

  // GPS: asegurar lectura + búsqueda si falta unidad (contrato, no semántica)
  if (
    plan.task === "gps" &&
    !plan.requestedCapabilities.some((c) => c.name === "gps.get_status")
  ) {
    plan = {
      ...plan,
      requestedCapabilities: [
        ...plan.requestedCapabilities,
        { name: "gps.get_status", params: {} },
      ],
    };
  }
  // unit.search solo con flota cargada; si no, gps.get_status pide unidad sin "no_fleet".
  if (
    plan.task === "gps" &&
    !state.unit &&
    !plan.unitReference &&
    state.fleetCache.length > 0 &&
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
    plan = enrichPlanForFleetSearchQuery(plan, state, input.message);
  }
  // Con filtro ya en el mensaje/ref y flota: buscar (no listar todo).
  // También con unidad activa: otra patente/código cierra el hilo anterior.
  if (
    plan.task === "gps" &&
    isExplicitUnitReference(plan.unitReference) &&
    state.fleetCache.length > 0 &&
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
    plan = enrichPlanForFleetSearchQuery(plan, state, input.message);
  }

  // Ensure company selected for ops if only one contact
  // (no auto-seleccionar si el usuario pidió reiniciar/cambiar empresa).
  const companyResetPending = plan.requestedCapabilities.some(
    (c) =>
      c.name === "company.list" &&
      (c.params?.reset === true || plan.stateIntent?.preserveCompany === false),
  );
  if (
    !state.company &&
    state.availableCompanies.length === 1 &&
    !companyResetPending
  ) {
    state = { ...state, company: state.availableCompanies[0]! };
  }

  // Sin empresa: solo menú empresas (nunca flota vacía + GPS + empresas juntos).
  plan = enrichPlanForCompanyOpsGate(plan, state);

  // Sin flota: no ejecutar unit.search (evita "No pude cargar la flota" inútil).
  if (!state.fleetCache.length) {
    plan = {
      ...plan,
      requestedCapabilities: plan.requestedCapabilities.filter(
        (c) => c.name !== "unit.search",
      ),
    };
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
      plan.conversationalAct === "continue_task" ||
      plan.conversationalAct === "start_task" ||
      plan.taskAction === "start"
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

  // Contrato: si este turno SELECCIONA o ya RESUELVE una unidad exacta,
  // no listar flota (evita "¿En qué te ayudo?" + listado completo).
  // Con unidad YA activa + GPS/trámite de lectura/escritura: tampoco listar,
  // salvo pedido explícito de OTRA unidad que todavía no resolvió.
  const explicitUnitUnresolved =
    isExplicitUnitReference(plan.unitReference) && !resolvedUnit;
  const unitAlreadyKnown = Boolean(
    resolvedUnit ||
      plan.requestedCapabilities.some((c) => c.name === "unit.select") ||
      (state.unit &&
        !explicitUnitUnresolved &&
        (plan.task === "gps" ||
          plan.task === "odometer" ||
          plan.task === "hourmeter" ||
          plan.task === "certificate" ||
          plan.requestedCapabilities.some((c) => c.name === "gps.get_status"))),
  );
  if (unitAlreadyKnown) {
    plan = {
      ...plan,
      task: plan.task === "unit_query" ? null : plan.task,
      requestedCapabilities: plan.requestedCapabilities.filter(
        (c) => c.name !== "unit.search",
      ),
    };
  }

  // Orden estable: select → search (si falta unidad) → prepare → resto
  {
    const caps = plan.requestedCapabilities;
    const select = caps.filter((c) => c.name === "unit.select");
    const prepare = caps.filter((c) => String(c.name).endsWith(".prepare"));
    const search = caps.filter((c) => c.name === "unit.search");
    const rest = caps.filter(
      (c) =>
        c.name !== "unit.select" &&
        c.name !== "unit.search" &&
        !String(c.name).endsWith(".prepare"),
    );
    plan = {
      ...plan,
      requestedCapabilities: [...select, ...search, ...prepare, ...rest],
    };
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

  // Último cinturón: post-enrich GPS/flota fantasma tras despedida → menú.
  plan = enrichPlanForOpenConsult(plan, state, input.message);

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

  // Cancel DEBE ganar sobre patches de execute (pendingWrite residual).
  // Switch/start: el prepare de execute ya armó activeTask/lastQuestion — no pisarlos
  // con un rebuild desde suppliedFields (reinyectaba el código de unidad como km).
  const cancelWins =
    plan.conversationalAct === "cancel_task" || plan.taskAction === "cancel";

  let finalState: ConversationStateV3 = cancelWins
    ? {
        ...applied.state,
        unit: state.unit ?? applied.state.unit,
        previousUnit: state.previousUnit ?? applied.state.previousUnit,
        company: state.company ?? applied.state.company,
        lastListing: state.lastListing ?? applied.state.lastListing,
      }
    : {
        ...applied.state,
        activeTask: state.activeTask ?? applied.state.activeTask,
        pendingWrite: state.pendingWrite ?? applied.state.pendingWrite,
        pendingEntity: state.pendingEntity ?? applied.state.pendingEntity,
        lastQuestion: state.lastQuestion ?? applied.state.lastQuestion,
        lastListing: state.lastListing ?? applied.state.lastListing,
        unit: state.unit ?? applied.state.unit,
        previousUnit: state.previousUnit ?? applied.state.previousUnit,
        company: state.company ?? applied.state.company,
        conversationMetadata:
          state.conversationMetadata ?? applied.state.conversationMetadata,
      };

  if (
    String(plan.reasoning ?? "").includes("Confirmación idle") &&
    finalState.pendingWrite
  ) {
    finalState = {
      ...finalState,
      lastQuestion: {
        id: randomUUID(),
        purpose: "idle_pending_confirm",
        expected: "clarification",
      },
    };
  }

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
    return `Hay una confirmación pendiente de ${state.pendingWrite.task}. Respondé CONFIRMO, CANCELAR, o pedime otro trámite (odómetro, GPS…).`;
  }
  if (state.pendingEntity?.type === "unit" || state.lastQuestion?.expected === "unit") {
    return "Necesito la patente, el número de la lista o la marca/prefijo de la unidad para seguir.";
  }
  if (state.lastQuestion?.expected === "company" || !state.company) {
    if (state.availableCompanies.length > 1) {
      return "¿Con qué empresa seguimos? Decime el número o el nombre.";
    }
  }
  if (state.lastQuestion?.expected === "value") {
    return "Pasame el valor numérico para continuar.";
  }
  if (
    state.activeTask?.type === "gps" ||
    String(state.lastQuestion?.purpose ?? "").includes("gps")
  ) {
    return "Para el reporte GPS necesito la patente, el número de la lista o la marca/prefijo de la unidad.";
  }
  if (!state.activeTask) {
    return "¿En qué te ayudo? Puedo con odómetro, certificado, GPS, o guías de la plataforma (Opciones / Unidades).";
  }
  return "Necesito una aclaración puntual: ¿qué querés hacer exactamente con el trámite actual?";
}

/** Si el LLM falla pero el mensaje pide GPS con marca/patente, recuperar sin spam genérico. */
function tryRecoverGpsPlan(
  state: ConversationStateV3,
  message: string,
): TurnPlan | null {
  const hint = extractFleetFilterHint(message, state);
  const wantsGps =
    state.activeTask?.type === "gps" ||
    String(state.lastQuestion?.purpose ?? "").includes("gps") ||
    /\b(reporte|gps|ubicaci[oó]n|estado)\b/i.test(message);
  if (!wantsGps) return null;
  if (!hint && state.unit) {
    return {
      reasoning: "Recupero GPS con unidad activa tras plan inválido.",
      conversationalAct: "continue_task",
      task: "gps",
      taskAction: "continue",
      requestedCapabilities: [{ name: "gps.get_status", params: {} }],
      stateIntent: {
        preserveCompany: true,
        preserveUnit: true,
        preserveTask: true,
      },
      responseGoal: { purpose: "inform", facts: [], nextQuestion: null },
      confidence: 0.85,
    };
  }
  if (!hint) return null;
  return {
    reasoning: `Recupero GPS con filtro «${hint}» tras plan inválido.`,
    conversationalAct: "continue_task",
    task: "gps",
    taskAction: "continue",
    unitReference: {
      kind: "unit",
      mode: "named",
      value: hint,
      reference: null,
    },
    requestedCapabilities: [
      { name: "unit.search", params: { query: hint, mode: "query" } },
      { name: "gps.get_status", params: {} },
    ],
    stateIntent: {
      preserveCompany: true,
      preserveUnit: true,
      preserveTask: true,
    },
    responseGoal: { purpose: "inform", facts: [], nextQuestion: null },
    confidence: 0.85,
  };
}

/** Si el LLM falla pero el mensaje pide odómetro/horómetro + unidad, arrancar trámite. */
function tryRecoverMeterStartPlan(
  state: ConversationStateV3,
  message: string,
): TurnPlan | null {
  if (state.pendingWrite) return null;
  if (
    state.activeTask?.type === "odometer" ||
    state.activeTask?.type === "hourmeter"
  ) {
    return null;
  }
  const t = message
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const meter: "odometer" | "hourmeter" | null = /\b(od[oó]metro|odometro|odo)\b/.test(
    t,
  )
    ? "odometer"
    : /\b(hor[oó]metro|horometro|horo)\b/.test(t)
      ? "hourmeter"
      : null;
  if (!meter) return null;
  const code = extractUnitNameCode(message);
  const prep = meter === "hourmeter" ? "hourmeter.prepare" : "odometer.prepare";
  return {
    reasoning: `Recupero inicio de ${meter} tras plan inválido.`,
    conversationalAct: "start_task",
    task: meter,
    taskAction: "start",
    unitReference: code
      ? { kind: "unit", mode: "unit_name", value: code, reference: null }
      : null,
    requestedCapabilities: [{ name: prep, params: {} }],
    stateIntent: {
      preserveCompany: true,
      preserveUnit: true,
      preserveTask: true,
    },
    responseGoal: { purpose: "ask_missing", facts: [], nextQuestion: null },
    confidence: 0.9,
  };
}

/** Stub + enrich de campo esperado cuando el TurnPlan LLM es null/inválido. */
function tryRecoverExpectedFieldPlan(
  state: ConversationStateV3,
  message: string,
  dtOpts: { timezone: string; localNow: string },
): TurnPlan | null {
  const expected = state.lastQuestion?.expected;
  if (
    expected !== "value" &&
    expected !== "unit" &&
    expected !== "date" &&
    expected !== "time"
  ) {
    return null;
  }
  const base: TurnPlan = {
    reasoning: "Captura de campo esperado tras plan inválido o ausente.",
    conversationalAct: "continue_task",
    task: state.activeTask?.type ?? null,
    taskAction: "continue",
    requestedCapabilities: [],
    stateIntent: {
      preserveCompany: true,
      preserveUnit: true,
      preserveTask: true,
    },
    responseGoal: { purpose: "ask_missing", facts: [], nextQuestion: null },
    confidence: 0.85,
  };
  let next = enrichPlanForExpectedFields(base, state, message);
  if (expected === "date" || expected === "time") {
    next = enrichPlanWithNaturalDatetime(next, state, message, dtOpts);
  }
  const captured =
    (expected === "value" && next.suppliedFields?.value != null) ||
    (expected === "unit" && Boolean(next.unitReference)) ||
    (expected === "date" &&
      (Boolean(next.suppliedFields?.date) ||
        Boolean(next.suppliedFields?.observedAt))) ||
    (expected === "time" &&
      (Boolean(next.suppliedFields?.time) ||
        Boolean(next.suppliedFields?.observedAt)));
  return captured ? next : null;
}
