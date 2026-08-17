/**
 * Comparación A/B: Commander V3 vs Runtime Next (mismo corpus, interpretationOverride).
 * Ejecutar: pnpm exec tsx src/conversation-runtime-next/tests/ab-compare.ts
 */
import { createEmptyConversationStateV3 } from "../../commander-v3/types/state.js";
import { decideTurn, filterAuthorizedCapabilities } from "../controller/decide-turn.js";
import { planFromDecision } from "../controller/plan-from-decision.js";
import type { TurnInterpretation } from "../types/interpretation.js";

type CorpusCase = {
  name: string;
  message: string;
  setup?: (s: ReturnType<typeof createEmptyConversationStateV3>) => void;
  interpretation: TurnInterpretation;
};

const corpus: CorpusCase[] = [
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
    name: "switch_odometro",
    message: "cargar odómetro",
    setup: (s) => {
      s.activeTask = { type: "gps", status: "collecting", collected: {}, missing: ["unit"] };
    },
    interpretation: {
      userAct: "request",
      relation: "switch",
      normalizedMeaning: "Odómetro",
      requests: [{ serviceId: "odometer.prepare", domain: "odometer", goal: "km", entities: {} }],
      references: [],
      corrections: [],
      answersExpectedField: false,
      confidence: 0.9,
    },
  },
];

function v3Heuristic(case_: CorpusCase, state: ReturnType<typeof createEmptyConversationStateV3>): {
  wouldGps: boolean;
  wouldKeepOrClose: boolean;
} {
  const open = Boolean(state.activeTask?.status === "collecting");
  const greet = /^hola[\s!.]*$/i.test(case_.message.trim());
  return {
    wouldGps: greet && open && case_.interpretation.relation !== "pause",
    wouldKeepOrClose: greet && open,
  };
}

function nextDecision(case_: CorpusCase, state: ReturnType<typeof createEmptyConversationStateV3>) {
  let d = decideTurn({
    interpretation: case_.interpretation,
    state,
    message: case_.message,
  });
  d = { ...d, authorizedCapabilities: filterAuthorizedCapabilities(d) };
  const plan = planFromDecision({ decision: d, interpretation: case_.interpretation });
  return { decision: d, plan };
}

console.log("A/B Commander V3 (heurística) vs Runtime Next\n");
for (const c of corpus) {
  const state = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
  if (c.setup) c.setup(state);
  const v3 = v3Heuristic(c, state);
  const next = nextDecision(c, state);
  const caps = next.plan.requestedCapabilities.map((x) => x.name);
  console.log(`--- ${c.name} ---`);
  console.log(`  V3 heuristic: gps=${v3.wouldGps} keep_or_close=${v3.wouldKeepOrClose}`);
  console.log(`  Next: action=${next.decision.action} act=${next.decision.conversationalAct} caps=[${caps.join(",")}]`);
  console.log("");
}
