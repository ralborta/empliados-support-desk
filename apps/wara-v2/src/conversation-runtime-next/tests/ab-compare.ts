/**
 * Comparación A/B ampliada: Commander V3 heurística vs Runtime Next.
 */
import { createEmptyConversationStateV3 } from "../../commander-v3/types/state.js";
import { decideTurn, filterAuthorizedCapabilities } from "../controller/decide-turn.js";
import { planFromDecision } from "../controller/plan-from-decision.js";
import type { TurnInterpretation } from "../types/interpretation.js";

type Case = {
  name: string;
  message: string;
  setup?: (s: ReturnType<typeof createEmptyConversationStateV3>) => void;
  interpretation: TurnInterpretation;
};

const corpus: Case[] = [
  {
    name: "hola_gps_pendiente",
    message: "Hola",
    setup: (s) => {
      s.activeTask = { type: "gps", status: "collecting", collected: {}, missing: ["unit"] };
      s.lastQuestion = { id: "q", purpose: "unit_for_gps", expected: "unit" };
    },
    interpretation: {
      userAct: "greeting",
      relation: "pause",
      normalizedMeaning: "Saludo",
      requests: [],
      references: [],
      corrections: [],
      answersExpectedField: false,
      confidence: 0.95,
    },
  },
  {
    name: "lateral_empresa",
    message: "¿cuál es mi empresa?",
    setup: (s) => {
      s.activeTask = { type: "gps", status: "collecting", collected: {}, missing: ["unit"] };
      s.company = { id: "1", name: "Test", contactId: 1 };
    },
    interpretation: {
      userAct: "question",
      relation: "side_question",
      normalizedMeaning: "Empresa activa",
      requests: [{ serviceId: "company.active", domain: "company", goal: "empresa", entities: {} }],
      references: [],
      corrections: [],
      answersExpectedField: false,
      confidence: 0.9,
    },
  },
  {
    name: "switch_explicito_odometro",
    message: "Dejá eso, mejor carguemos el kilometraje.",
    setup: (s) => {
      s.activeTask = { type: "gps", status: "collecting", collected: {}, missing: ["unit"] };
    },
    interpretation: {
      userAct: "cancellation",
      relation: "switch",
      normalizedMeaning: "Abandona GPS y carga odómetro.",
      requests: [{ serviceId: "odometer.prepare", domain: "odometer", goal: "km", entities: {} }],
      references: [],
      corrections: [],
      answersExpectedField: false,
      confidence: 0.95,
    },
  },
  {
    name: "switch_sin_abandono",
    message: "quiero certificado",
    setup: (s) => {
      s.activeTask = { type: "gps", status: "collecting", collected: {}, missing: ["unit"] };
    },
    interpretation: {
      userAct: "request",
      relation: "standalone",
      normalizedMeaning: "Pide certificado sin abandonar.",
      requests: [{ serviceId: "certificate.prepare", domain: "certificate", goal: "cert", entities: {} }],
      references: [],
      corrections: [],
      answersExpectedField: false,
      confidence: 0.7,
    },
  },
  {
    name: "confirmo_sin_pending",
    message: "CONFIRMO",
    interpretation: {
      userAct: "confirmation",
      relation: "confirm",
      normalizedMeaning: "Confirma sin pending.",
      requests: [],
      references: [],
      corrections: [],
      answersExpectedField: false,
      confidence: 0.8,
    },
  },
  {
    name: "referencia_la_segunda",
    message: "la segunda",
    setup: (s) => {
      s.lastListing = {
        kind: "search",
        page: 1,
        pageSize: 2,
        totalCount: 2,
        items: [
          { index: 1, label: "AA", movilId: 1 },
          { index: 2, label: "BB", movilId: 2 },
        ],
        fetchedAt: new Date().toISOString(),
      };
    },
    interpretation: {
      userAct: "answer",
      relation: "answer_expected",
      normalizedMeaning: "Selecciona segunda unidad.",
      requests: [],
      references: [{ type: "index", expression: "2", index: 2, source: "last_presented" }],
      corrections: [],
      answersExpectedField: true,
      confidence: 0.9,
    },
  },
];

function v3Heuristic(c: Case, state: ReturnType<typeof createEmptyConversationStateV3>) {
  const open = state.activeTask?.status === "collecting";
  const greet = /^hola[\s!.]*$/i.test(c.message.trim());
  return {
    keep_or_close: greet && open,
    would_inject_gps_on_greet: greet && open,
  };
}

console.log("A/B Commander V3 (heurística) vs Runtime Next — corpus ampliado\n");
for (const c of corpus) {
  const state = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
  if (c.setup) c.setup(state);
  const v3 = v3Heuristic(c, state);
  let d = decideTurn({ interpretation: c.interpretation, state, message: c.message });
  d = { ...d, authorizedCapabilities: filterAuthorizedCapabilities(d) };
  const plan = planFromDecision({ decision: d, interpretation: c.interpretation });
  const caps = plan.requestedCapabilities.map((x) => x.name);
  console.log(`--- ${c.name} ---`);
  console.log(`  V3: keep_or_close=${v3.keep_or_close}`);
  console.log(`  Next: action=${d.action} act=${d.conversationalAct} task=${d.task ?? "-"} caps=[${caps.join(",")}]`);
  console.log("");
}
