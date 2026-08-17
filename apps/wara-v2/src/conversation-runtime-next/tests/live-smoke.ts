/**
 * Smoke multi-turno con LLM real + trazas sanitizadas.
 *
 * Local (sin API key): modo --dry con interpretationOverride para validar pipeline.
 * Shadow (con API key):
 *   OPENAI_API_KEY=... pnpm exec tsx src/conversation-runtime-next/tests/live-smoke.ts
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { processConversationTurn } from "../process-turn.js";
import { resetConversationStateV3 } from "../../commander-v3/persistence/store.js";
import {
  getConversationStateV3,
  saveConversationStateV3,
} from "../../commander-v3/persistence/store-helpers.js";
import { initCommanderV3PersistenceFromEnv } from "../../commander-v3/index.js";
import type { TurnInterpretation } from "../types/interpretation.js";
import type { ConversationStateV3 } from "../../commander-v3/types/state.js";
import { createEmptyConversationStateV3 } from "../../commander-v3/types/state.js";
import { extractProtectedBlocks } from "../compose/composer.js";

initCommanderV3PersistenceFromEnv(process.env);

const tenant = "tenant_smoke";
const phone = "+5491199000001";
const dryMode = process.argv.includes("--dry");

type TurnExpect = {
  action?: string;
  conversationalAct?: string;
  task?: string | null;
  maxCapabilities?: number;
  minCapabilities?: number;
  capabilityNames?: string[];
  noCapViolation?: boolean;
  noWrites?: boolean;
  replyContains?: string[];
  replyNotContains?: string[];
  stateTask?: string | null;
  preserveCompany?: boolean;
};

type TurnSpec = {
  id: string;
  message: string;
  setup?: (s: ConversationStateV3) => void;
  interpretationOverride?: TurnInterpretation;
  expect?: TurnExpect;
};

const smokeContactsDual = [
  { id: 64866, nombre: "WARA", empresa: "WARA" },
  { id: 131776, nombre: "El Cacique S.A.", empresa: "El Cacique S.A." },
];

type Scenario = {
  name: string;
  turns: TurnSpec[];
  contacts?: Array<{ id: number; nombre: string; empresa: string }>;
};

const company = { id: "1", name: "Smoke Co", contactId: 1 };

function fleet900088() {
  return [
    {
      movilId: 501,
      plate: "AA900088",
      name: "M900-088",
      label: "Unidad (M900-088)",
      odometer: null,
      hourmeter: null,
    },
  ];
}

function fleetUnitsFromState(s: ConversationStateV3) {
  return (s.fleetCache ?? []).map((u) => ({
    movil_id: u.movilId,
    unidad: u.name ?? "",
    patente: u.plate ?? "",
    odometro: u.odometer ?? null,
    horometro: u.hourmeter ?? null,
  }));
}

function gpsOpenSetup(s: ConversationStateV3) {
  s.company = company;
  s.activeTask = {
    type: "gps",
    status: "collecting",
    collected: {},
    missing: ["unit"],
  };
  s.lastQuestion = { id: "q1", purpose: "unit_for_gps", expected: "unit" };
}

function pendingCertSetup(s: ConversationStateV3) {
  s.company = company;
  s.unit = { movilId: 431, plate: "AA431", name: "Unidad 431", label: "AA431 (Unidad 431)" };
  s.pendingWrite = {
    operationId: "op-smoke",
    version: 1,
    payloadHash: "h",
    task: "certificate",
    summary: { plate: "AA431" },
  };
  s.lastQuestion = { id: "c", purpose: "confirm_certificate", expected: "confirmation" };
  s.activeTask = {
    type: "certificate",
    status: "awaiting_confirmation",
    collected: { plate: "AA431" },
    missing: [],
  };
}

const scenarios: Scenario[] = [
  {
    name: "saludo_con_gps_pendiente",
    turns: [
      {
        id: "s1",
        message: "¿Dónde está la unidad?",
        setup: gpsOpenSetup,
        interpretationOverride: {
          userAct: "request",
          relation: "standalone",
          normalizedMeaning: "Ubicación GPS",
          requests: [{ serviceId: "gps.status", domain: "gps", goal: "ubicación", entities: {} }],
          references: [],
          corrections: [],
          answersExpectedField: false,
          confidence: 0.9,
        },
      },
      {
        id: "s2",
        message: "Hola",
        interpretationOverride: {
          userAct: "greeting",
          relation: "pause",
          normalizedMeaning: "Saludo",
          requests: [],
          references: [],
          corrections: [],
          answersExpectedField: false,
          confidence: 0.95,
        },
        expect: {
          action: "respond",
          conversationalAct: "greet",
          maxCapabilities: 0,
          noCapViolation: true,
          noWrites: true,
        },
      },
    ],
  },
  {
    name: "pregunta_lateral_tarea_abierta",
    turns: [
      {
        id: "l1",
        message: "gps de la unidad",
        setup: gpsOpenSetup,
        interpretationOverride: {
          userAct: "request",
          relation: "standalone",
          normalizedMeaning: "GPS unidad",
          requests: [{ serviceId: "gps.status", domain: "gps", goal: "ubicación", entities: {} }],
          references: [],
          corrections: [],
          answersExpectedField: false,
          confidence: 0.9,
        },
      },
      {
        id: "l2",
        message: "¿cuál es mi empresa?",
        interpretationOverride: {
          userAct: "question",
          relation: "side_question",
          normalizedMeaning: "Empresa activa",
          requests: [
            { serviceId: "company.active", domain: "company", goal: "empresa", entities: {} },
          ],
          references: [],
          corrections: [],
          answersExpectedField: false,
          confidence: 0.9,
        },
        expect: {
          action: "execute",
          conversationalAct: "answer_lateral",
          capabilityNames: ["company.get_active"],
          noCapViolation: true,
          noWrites: true,
        },
      },
    ],
  },
  {
    name: "cambio_explicito_odometro",
    turns: [
      {
        id: "c1",
        message: "ubicación de la unidad",
        setup: gpsOpenSetup,
        interpretationOverride: {
          userAct: "request",
          relation: "standalone",
          normalizedMeaning: "Ubicación",
          requests: [{ serviceId: "gps.status", domain: "gps", goal: "ubicación", entities: {} }],
          references: [],
          corrections: [],
          answersExpectedField: false,
          confidence: 0.9,
        },
      },
      {
        id: "c2",
        message: "Dejá eso, mejor carguemos el kilometraje.",
        interpretationOverride: {
          userAct: "request",
          relation: "switch",
          normalizedMeaning: "Cambio a odómetro",
          requests: [
            {
              serviceId: "odometer.prepare",
              domain: "odometer",
              goal: "kilometraje",
              entities: {},
            },
          ],
          references: [],
          corrections: [],
          answersExpectedField: false,
          confidence: 0.92,
        },
        expect: {
          action: "execute",
          conversationalAct: "switch_task",
          task: "odometer",
          noCapViolation: true,
          noWrites: true,
        },
      },
    ],
  },
  {
    name: "cambio_ambiguo_keep_or_close",
    turns: [
      {
        id: "a1",
        message: "gps de la unidad",
        setup: gpsOpenSetup,
        interpretationOverride: {
          userAct: "request",
          relation: "standalone",
          normalizedMeaning: "GPS",
          requests: [{ serviceId: "gps.status", domain: "gps", goal: "ubicación", entities: {} }],
          references: [],
          corrections: [],
          answersExpectedField: false,
          confidence: 0.9,
        },
      },
      {
        id: "a2",
        message: "quiero el certificado",
        interpretationOverride: {
          userAct: "request",
          relation: "standalone",
          normalizedMeaning: "Certificado sin abandono explícito",
          requests: [
            {
              serviceId: "certificate.prepare",
              domain: "certificate",
              goal: "certificado",
              entities: {},
            },
          ],
          references: [],
          corrections: [],
          answersExpectedField: false,
          confidence: 0.8,
        },
        expect: {
          action: "keep_or_close",
          maxCapabilities: 0,
          noCapViolation: true,
          noWrites: true,
        },
      },
    ],
  },
  {
    name: "correccion_antes_confirmar",
    turns: [
      {
        id: "r2",
        message: "confirmo, pero con fecha 15/01",
        setup: pendingCertSetup,
        interpretationOverride: {
          userAct: "correction",
          relation: "confirm",
          normalizedMeaning: "Confirma con corrección de fecha",
          requests: [],
          references: [],
          corrections: [{ field: "date", value: "2026-01-15" }],
          answersExpectedField: false,
          confidence: 0.9,
          confirmation: { intended: true, containsCorrections: true },
        },
        expect: {
          action: "execute",
          maxCapabilities: 0,
          noCapViolation: true,
          noWrites: true,
        },
      },
    ],
  },
  {
    name: "confirmo_sin_operacion",
    turns: [
      {
        id: "p1",
        message: "CONFIRMO",
        interpretationOverride: {
          userAct: "confirmation",
          relation: "confirm",
          normalizedMeaning: "Confirma sin pending",
          requests: [],
          references: [],
          corrections: [],
          answersExpectedField: false,
          confidence: 0.9,
        },
        expect: {
          action: "clarify",
          maxCapabilities: 0,
          noCapViolation: true,
          noWrites: true,
          replyContains: ["ninguna operación pendiente"],
        },
      },
    ],
  },
  {
    name: "referencia_la_segunda",
    turns: [
      {
        id: "seg1",
        message: "la segunda",
        setup: (s) => {
          s.company = company;
          s.lastListing = {
            kind: "search",
            page: 1,
            pageSize: 2,
            totalCount: 2,
            items: [
              { index: 1, label: "AA 111", movilId: 1 },
              { index: 2, label: "BB 222", movilId: 2 },
            ],
            fetchedAt: new Date().toISOString(),
          };
        },
        interpretationOverride: {
          userAct: "answer",
          relation: "answer_expected",
          normalizedMeaning: "Segunda unidad del listado",
          requests: [],
          references: [{ type: "index", expression: "2", index: 2, source: "last_presented" }],
          corrections: [],
          answersExpectedField: true,
          confidence: 0.9,
        },
        expect: {
          action: "execute",
          noCapViolation: true,
          noWrites: true,
        },
      },
    ],
  },
  {
    name: "referencia_la_misma",
    turns: [
      {
        id: "mis1",
        message: "gps de la misma",
        setup: (s) => {
          s.company = company;
          s.unit = { movilId: 5, plate: "CC555", name: "M5", label: "CC555 (M5)" };
        },
        interpretationOverride: {
          userAct: "request",
          relation: "continue",
          normalizedMeaning: "GPS de la misma unidad",
          requests: [{ serviceId: "gps.status", domain: "gps", goal: "ubicación", entities: {} }],
          references: [{ type: "unit", expression: "la misma", source: "active" }],
          corrections: [],
          answersExpectedField: false,
          confidence: 0.85,
        },
        expect: {
          action: "execute",
          noCapViolation: true,
          noWrites: true,
        },
      },
    ],
  },
  {
    name: "dos_solicitudes_un_mensaje",
    turns: [
      {
        id: "d1",
        message: "gps y certificado de la 431",
        setup: (s) => {
          s.company = company;
        },
        interpretationOverride: {
          userAct: "request",
          relation: "standalone",
          normalizedMeaning: "GPS y certificado de la 431",
          requests: [
            { serviceId: "gps.status", domain: "gps", goal: "ubicación", entities: {} },
            {
              serviceId: "certificate.prepare",
              domain: "certificate",
              goal: "certificado",
              entities: { plate: "431" },
            },
          ],
          references: [],
          corrections: [],
          answersExpectedField: false,
          confidence: 0.75,
          ambiguity: {
            reason: "Dos trámites en un mensaje",
            alternatives: ["gps", "certificate"],
            clarificationQuestion: "¿Primero el GPS o el certificado de la 431?",
          },
        },
        expect: {
          action: "clarify",
          noCapViolation: true,
          noWrites: true,
        },
      },
    ],
  },
  {
    name: "consulta_general_tarea_abierta",
    turns: [
      {
        id: "g1",
        message: "gps de la unidad",
        setup: gpsOpenSetup,
        interpretationOverride: {
          userAct: "request",
          relation: "standalone",
          normalizedMeaning: "GPS",
          requests: [{ serviceId: "gps.status", domain: "gps", goal: "ubicación", entities: {} }],
          references: [],
          corrections: [],
          answersExpectedField: false,
          confidence: 0.9,
        },
      },
      {
        id: "g2",
        message: "¿cómo funciona el certificado?",
        interpretationOverride: {
          userAct: "question",
          relation: "side_question",
          normalizedMeaning: "Consulta general sobre certificado",
          requests: [
            {
              serviceId: "domain.answer",
              domain: "knowledge",
              goal: "explicar certificado",
              entities: { topic: "certificate" },
            },
          ],
          references: [],
          corrections: [],
          answersExpectedField: false,
          confidence: 0.85,
        },
        expect: {
          action: "execute",
          conversationalAct: "answer_lateral",
          noCapViolation: true,
          noWrites: true,
        },
      },
    ],
  },
  {
    name: "servicio_mantenimiento",
    turns: [
      {
        id: "m1",
        message: "registrar mantenimiento de la 431",
        setup: (s) => {
          s.company = company;
        },
        interpretationOverride: {
          userAct: "request",
          relation: "standalone",
          normalizedMeaning: "Registrar mantenimiento",
          requests: [
            {
              serviceId: "maintenance.prepare",
              domain: "maintenance",
              goal: "mantenimiento",
              entities: { plate: "431" },
            },
          ],
          references: [],
          corrections: [],
          answersExpectedField: false,
          confidence: 0.9,
        },
        expect: {
          action: "execute",
          task: "maintenance",
          noCapViolation: true,
          noWrites: true,
        },
      },
    ],
  },
  {
    name: "horometro_saludo_luego_unidad",
    turns: [
      {
        id: "h1",
        message: "Quiero cargar horómetro",
        setup: (s) => {
          s.company = company;
        },
        interpretationOverride: {
          userAct: "request",
          relation: "standalone",
          normalizedMeaning: "Cargar horómetro",
          requests: [
            {
              serviceId: "hourmeter.prepare",
              domain: "hourmeter",
              goal: "cargar horómetro",
              entities: {},
            },
          ],
          references: [],
          corrections: [],
          answersExpectedField: false,
          confidence: 0.9,
        },
        expect: {
          action: "execute",
          task: "hourmeter",
          noWrites: true,
        },
      },
      {
        id: "h2",
        message: "Hola",
        interpretationOverride: {
          userAct: "greeting",
          relation: "standalone",
          normalizedMeaning: "Saludo",
          requests: [],
          references: [],
          corrections: [],
          answersExpectedField: false,
          confidence: 0.95,
        },
        expect: {
          action: "respond",
          conversationalAct: "greet",
          maxCapabilities: 0,
          replyNotContains: ["No encontré", "patente desconocida", "identificador"],
          stateTask: "hourmeter",
          noWrites: true,
        },
      },
      {
        id: "h3",
        message: "900088",
        setup: (s) => {
          s.lastQuestion = {
            id: "uq",
            purpose: "unit_for_hourmeter",
            expected: "unit",
          };
          s.fleetCache = fleet900088();
        },
        interpretationOverride: {
          userAct: "answer",
          relation: "answer_expected",
          normalizedMeaning: "Código unidad",
          requests: [],
          references: [],
          corrections: [],
          answersExpectedField: true,
          confidence: 0.9,
        },
        expect: {
          action: "execute",
          conversationalAct: "continue_task",
          capabilityNames: ["unit.select"],
          stateTask: "hourmeter",
          noWrites: true,
        },
      },
    ],
  },
  {
    name: "horometro_pregunta_lateral_luego_unidad",
    turns: [
      {
        id: "l1",
        message: "Quiero cargar horómetro",
        setup: (s) => {
          s.company = company;
        },
        interpretationOverride: {
          userAct: "request",
          relation: "standalone",
          normalizedMeaning: "Cargar horómetro",
          requests: [
            {
              serviceId: "hourmeter.prepare",
              domain: "hourmeter",
              goal: "cargar horómetro",
              entities: {},
            },
          ],
          references: [],
          corrections: [],
          answersExpectedField: false,
          confidence: 0.9,
        },
        expect: {
          action: "execute",
          task: "hourmeter",
          noWrites: true,
        },
      },
      {
        id: "l2",
        message: "¿Qué empresa tengo activa?",
        interpretationOverride: {
          userAct: "question",
          relation: "side_question",
          normalizedMeaning: "Consulta empresa activa",
          requests: [
            {
              serviceId: "company.status",
              domain: "company",
              goal: "empresa activa",
              entities: {},
            },
          ],
          references: [],
          corrections: [],
          answersExpectedField: false,
          confidence: 0.9,
        },
        expect: {
          maxCapabilities: 0,
          replyNotContains: ["No encontré", "identificador", "patente desconocida"],
          stateTask: "hourmeter",
          noWrites: true,
        },
      },
      {
        id: "l3",
        message: "900088",
        setup: (s) => {
          s.lastQuestion = {
            id: "uq2",
            purpose: "unit_for_hourmeter",
            expected: "unit",
          };
          s.fleetCache = fleet900088();
        },
        interpretationOverride: {
          userAct: "answer",
          relation: "answer_expected",
          normalizedMeaning: "Código unidad",
          requests: [],
          references: [],
          corrections: [],
          answersExpectedField: true,
          confidence: 0.9,
        },
        expect: {
          action: "execute",
          conversationalAct: "continue_task",
          capabilityNames: ["unit.select"],
          stateTask: "hourmeter",
          noWrites: true,
        },
      },
    ],
  },
  {
    name: "colloquial_typos",
    turns: [
      {
        id: "t1",
        message: "dejá eso mejor cargemos el kilometraje de la 431",
        setup: gpsOpenSetup,
        interpretationOverride: {
          userAct: "request",
          relation: "switch",
          normalizedMeaning: "Abandona GPS y carga odómetro 431",
          requests: [
            {
              serviceId: "odometer.prepare",
              domain: "odometer",
              goal: "cargar kilometraje",
              entities: { plate: "431" },
            },
          ],
          references: [],
          corrections: [],
          answersExpectedField: false,
          confidence: 0.9,
        },
        expect: {
          action: "execute",
          conversationalAct: "switch_task",
          task: "odometer",
          noCapViolation: true,
          noWrites: true,
        },
      },
    ],
  },
  {
    name: "reiniciar_empresa_saludo_luego_indice",
    contacts: smokeContactsDual,
    turns: [
      {
        id: "e1",
        message: "Reiniciar empresa",
        setup: (s) => {
          s.company = { id: "131776", name: "El Cacique S.A.", contactId: 131776 };
          s.unit = {
            movilId: 90,
            plate: "AE483VE",
            name: "SAVEIRO",
            label: "AE 483 VE (SAVEIRO)",
          };
          s.availableCompanies = [
            { id: "64866", name: "WARA", contactId: 64866 },
            { id: "131776", name: "El Cacique S.A.", contactId: 131776 },
          ];
        },
        expect: {
          capabilityNames: ["company.list"],
          noWrites: true,
        },
      },
      {
        id: "e2",
        message: "Hola",
        expect: {
          maxCapabilities: 0,
          replyNotContains: ["No encontré", "identificador", "patente desconocida"],
          noWrites: true,
        },
      },
      {
        id: "e3",
        message: "2",
        setup: (s) => {
          s.lastQuestion = { id: "cq", purpose: "company_pick", expected: "company" };
          s.presentedCompanies = [
            { index: 1, id: "64866", name: "WARA" },
            { index: 2, id: "131776", name: "El Cacique S.A." },
          ];
        },
        expect: {
          capabilityNames: ["company.select"],
          noWrites: true,
        },
      },
    ],
  },
];

function stateSummary(s: ConversationStateV3) {
  return {
    company: s.company?.name ?? null,
    unit: s.unit?.label ?? s.unit?.plate ?? null,
    activeTask: s.activeTask?.type ?? null,
    activeTaskStatus: s.activeTask?.status ?? null,
    lastQuestionExpected: s.lastQuestion?.expected ?? null,
  };
}

function sanitize(obj: unknown): unknown {
  if (!obj || typeof obj !== "object") return obj;
  const o = { ...(obj as Record<string, unknown>) };
  delete o.phone;
  if (Array.isArray(o.recentTurns)) {
    o.recentTurns = (o.recentTurns as unknown[]).slice(-4);
  }
  return o;
}

function authorizedFromTrace(trace: Awaited<ReturnType<typeof processConversationTurn>>["trace"]): string[] {
  const rn = trace.runtimeNext;
  if (rn?.authorizedCapabilities?.length) return rn.authorizedCapabilities;
  return trace.capabilitiesRequested?.map((c) => c.name) ?? [];
}

function executedFromTrace(trace: Awaited<ReturnType<typeof processConversationTurn>>["trace"]): string[] {
  const rn = trace.runtimeNext;
  if (rn?.executedCapabilities?.length) return rn.executedCapabilities;
  return trace.capabilitiesExecuted ?? [];
}

function verifyTurn(
  scenario: string,
  turn: TurnSpec,
  result: Awaited<ReturnType<typeof processConversationTurn>>,
  stateBefore: ConversationStateV3,
): string[] {
  const errors: string[] = [];
  const { trace, reply, state } = result;
  const expect = turn.expect ?? {};
  const plan = trace.turnPlan;
  const interpretation = trace.runtimeNext?.interpretation;
  if (!interpretation) {
    errors.push("interpretation:null");
  }
  const decisionAction = plan?.responseGoal?.purpose === "confirm_write"
    ? "confirm_write"
    : trace.turnPlan?.conversationalAct === "ask" && plan?.responseGoal?.purpose === "clarify"
      ? "clarify"
      : undefined;

  const authorized = authorizedFromTrace(trace);
  const executed = executedFromTrace(trace);
  const capViolation = trace.runtimeNext?.capViolation ?? null;

  if (!reply.trim()) errors.push("reply vacía");
  if (expect.noCapViolation && capViolation) {
    errors.push(`capViolation: ${capViolation}`);
  }
  if (expect.noWrites) {
    if (trace.writeAttempt) errors.push("writeAttempt detectado");
    if (trace.writeExecuted) errors.push("writeExecuted detectado");
  }
  if (expect.maxCapabilities !== undefined && authorized.length > expect.maxCapabilities) {
    errors.push(`capabilities autorizadas > ${expect.maxCapabilities}: [${authorized.join(",")}]`);
  }
  if (expect.minCapabilities !== undefined && authorized.length < expect.minCapabilities) {
    errors.push(`capabilities autorizadas < ${expect.minCapabilities}`);
  }
  if (expect.capabilityNames) {
    for (const name of expect.capabilityNames) {
      if (!authorized.includes(name)) errors.push(`falta capability autorizada: ${name}`);
    }
  }
  if (expect.replyContains) {
    for (const frag of expect.replyContains) {
      if (!reply.toLowerCase().includes(frag.toLowerCase())) {
        errors.push(`reply no contiene: ${frag}`);
      }
    }
  }
  if (expect.replyNotContains) {
    for (const frag of expect.replyNotContains) {
      if (reply.toLowerCase().includes(frag.toLowerCase())) {
        errors.push(`reply contiene prohibido: ${frag}`);
      }
    }
  }

  // Infer action from runtimeNext interpretation path via turnPlan
  const inferredAction =
    plan?.responseGoal?.purpose === "confirm_write"
      ? "confirm_write"
      : plan?.conversationalAct === "greet"
        ? "respond"
        : plan?.responseGoal?.purpose === "clarify" && plan?.conversationalAct === "ask"
          ? trace.turnPlan?.reasoning?.includes("incompatible")
            ? "keep_or_close"
            : "clarify"
          : plan?.conversationalAct === "switch_task"
            ? "execute"
            : plan?.conversationalAct === "answer_lateral"
              ? "execute"
              : plan?.conversationalAct === "continue_task"
                ? "execute"
                : plan?.conversationalAct === "cancel_task"
                  ? "cancel"
                  : plan?.conversationalAct === "greet"
                    ? "respond"
                    : plan?.requestedCapabilities?.length
                      ? "execute"
                      : plan?.conversationalAct === "ask"
                        ? "clarify"
                        : "execute";

  if (expect.action && inferredAction !== expect.action) {
    errors.push(`action esperada ${expect.action}, obtuvo ${inferredAction}`);
  }
  if (expect.conversationalAct && plan?.conversationalAct !== expect.conversationalAct) {
    errors.push(
      `conversationalAct esperada ${expect.conversationalAct}, obtuvo ${plan?.conversationalAct}`,
    );
  }
  if (expect.task !== undefined && (plan?.task ?? null) !== expect.task) {
    errors.push(`task esperada ${expect.task}, obtuvo ${plan?.task ?? null}`);
  }
  if (expect.stateTask !== undefined && (state.activeTask?.type ?? null) !== expect.stateTask) {
    errors.push(`stateTask esperada ${expect.stateTask}, obtuvo ${state.activeTask?.type ?? null}`);
  }
  if (expect.preserveCompany && stateBefore.company && !state.company) {
    errors.push("company no conservada");
  }

  const protectedInFacts = extractProtectedBlocks(trace.responseFacts ?? []);
  if (protectedInFacts.length && reply) {
    for (const block of protectedInFacts) {
      const core = block.slice(0, 40);
      if (!reply.includes(core.slice(0, 20))) {
        errors.push("bloque protegido no conservado en reply");
        break;
      }
    }
  }

  if (authorized.length !== executed.length && executed.length > 0) {
    const diff = executed.filter((x) => !authorized.includes(x));
    if (diff.length) errors.push(`executed no autorizado: ${diff.join(",")}`);
  }

  if (errors.length) {
    console.error(`  FAIL [${scenario}/${turn.id}]: ${errors.join("; ")}`);
    console.error(`    reply: ${reply.slice(0, 120)}`);
    console.error(`    authorized=[${authorized.join(",")}] executed=[${executed.join(",")}]`);
  }

  return errors;
}

async function runScenario(scenario: Scenario, env: NodeJS.ProcessEnv, useOverrides: boolean) {
  resetConversationStateV3(tenant, phone);
  const traces: unknown[] = [];
  const allErrors: string[] = [];
  const contacts =
    scenario.contacts ?? [{ id: 1, nombre: "Smoke Co", empresa: "Smoke Co" }];

  for (const t of scenario.turns) {
    if (t.setup) {
      const s = getConversationStateV3(tenant, phone) ??
        createEmptyConversationStateV3({ tenantId: tenant, phone });
      t.setup(s);
      saveConversationStateV3(s);
    }

    const stateBefore = getConversationStateV3(tenant, phone) ??
      createEmptyConversationStateV3({ tenantId: tenant, phone });

    console.log(`[${scenario.name}/${t.id}] user: ${t.message}`);

    const override = useOverrides ? t.interpretationOverride : undefined;
    const r = await processConversationTurn({
      tenantId: tenant,
      phone,
      message: t.message,
      messageId: t.id,
      env,
      contacts,
      fleetUnits: fleetUnitsFromState(stateBefore),
      interpretationOverride: override,
    });

    console.log(`  reply: ${r.reply.slice(0, 200)}`);

    const parity = r.trace.runtimeNext?.operationalParity;
    const turnErrors = verifyTurn(scenario.name, t, r, stateBefore);
    allErrors.push(...turnErrors);

    traces.push({
      scenario: scenario.name,
      turnId: t.id,
      message: t.message,
      reply: r.reply,
      interpretation: useOverrides ? t.interpretationOverride : r.trace.runtimeNext?.interpretation,
      decision: parity?.decision ?? {
        action: r.trace.turnPlan?.conversationalAct,
        conversationalAct: r.trace.turnPlan?.conversationalAct,
        task: r.trace.turnPlan?.task,
      },
      expectedCapture: parity?.expectedCapture ?? null,
      action: r.trace.turnPlan?.conversationalAct,
      task: r.trace.turnPlan?.task,
      authorizedCapabilities: authorizedFromTrace(r.trace),
      executedCapabilities: executedFromTrace(r.trace),
      capViolation: r.trace.runtimeNext?.capViolation ?? null,
      writeAttempt: r.trace.writeAttempt,
      writeExecuted: r.trace.writeExecuted,
      stateBefore: stateSummary(stateBefore),
      stateAfter: stateSummary(r.state),
      activeTask: r.state.activeTask?.type,
      activeTaskStatus: r.state.activeTask?.status,
      validationOk: r.trace.validation?.ok,
      latencyMs: r.trace.latency?.totalMs ?? null,
      interpretMs: r.trace.latency?.commanderMs ?? null,
      interpreterDiagnostic: r.trace.runtimeNext?.interpreterDiagnostic ?? null,
    });
  }

  return { traces, errors: allErrors };
}

async function main() {
  const hasKey = Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.length >= 20);

  if (!hasKey && !dryMode) {
    console.log("BLOCKED: OPENAI_API_KEY no disponible en este entorno.");
    console.log("Usar --dry para validación local con overrides, o ejecutar en shadow con credenciales.");
    console.log("\nProcedimiento shadow (Next apagado en deploy):");
    console.log("  WARA_CONVERSATION_RUNTIME_NEXT=false");
    console.log("  WARA_CONVERSATION_COMMANDER_V3=true");
    console.log("  ALLOW_EXTERNAL_MUTATIONS=false");
    console.log("  DELIVERY_ENABLED=false");
    console.log("\nSmoke remoto:");
    console.log("  cd apps/wara-v2 && pnpm exec tsx src/conversation-runtime-next/tests/live-smoke.ts");
    process.exit(0);
  }

  const env = {
    ...process.env,
    ALLOW_EXTERNAL_MUTATIONS: "false",
    WARA_V2_PILOT_OPEN: "true",
    DELIVERY_ENABLED: "false",
  };

  const filterNames = process.env.LIVE_SMOKE_SCENARIOS?.split(",").map((s) => s.trim()).filter(Boolean);
  const selectedScenarios = filterNames?.length
    ? scenarios.filter((s) => filterNames.includes(s.name))
    : scenarios;

  console.log(`live-smoke: modo=${hasKey && !dryMode ? "llm" : "dry"}`);
  console.log(`escenarios: ${selectedScenarios.length}`);

  const allTraces: unknown[] = [];
  const globalErrors: string[] = [];

  const useOverrides = dryMode || !hasKey;

  for (const scenario of selectedScenarios) {
    console.log(`\n=== ${scenario.name} ===`);
    const { traces, errors } = await runScenario(scenario, env, useOverrides);
    allTraces.push(...traces);
    globalErrors.push(...errors);
  }

  const out = join(process.cwd(), "src/conversation-runtime-next/tests/live-smoke-traces.json");
  writeFileSync(out, JSON.stringify(sanitize(allTraces), null, 2), "utf8");
  console.log(`\nTrazas guardadas: ${out}`);

  if (globalErrors.length) {
    console.error(`\n${globalErrors.length} verificación(es) fallida(s).`);
    process.exit(1);
  }
  console.log("\nTodas las verificaciones pasaron.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
