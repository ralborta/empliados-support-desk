/**
 * Cambios explícitos de trámite — interpretación LLM, no regex sobre mensaje.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createEmptyConversationStateV3 } from "../../commander-v3/types/state.js";
import { decideTurn } from "../controller/decide-turn.js";
import { isExplicitTaskChange } from "../controller/explicit-change.js";
import type { TurnInterpretation } from "../types/interpretation.js";

function gpsOpen() {
  const s = createEmptyConversationStateV3({ tenantId: "t", phone: "+1" });
  s.company = { id: "1", name: "E", contactId: 1 };
  s.activeTask = { type: "gps", status: "collecting", collected: {}, missing: ["unit"] };
  return s;
}

const cases: Array<{
  label: string;
  message: string;
  setup?: (s: ReturnType<typeof createEmptyConversationStateV3>) => void;
  interp: TurnInterpretation;
  expectAction: string;
  expectTask?: string;
}> = [
  {
    label: "dejá eso kilometraje",
    message: "Dejá eso, carguemos kilometraje.",
    interp: {
      userAct: "cancellation",
      relation: "switch",
      normalizedMeaning: "Abandona GPS y carga odómetro.",
      requests: [{ serviceId: "odometer.prepare", domain: "odometer", goal: "km", entities: {} }],
      references: [],
      corrections: [],
      answersExpectedField: false,
      confidence: 0.95,
    },
    expectAction: "execute",
    expectTask: "odometer",
  },
  {
    label: "mejor certificado",
    message: "Mejor hagamos el certificado.",
    interp: {
      userAct: "request",
      relation: "switch",
      normalizedMeaning: "Cambia a certificado.",
      requests: [{ serviceId: "certificate.prepare", domain: "certificate", goal: "cert", entities: {} }],
      references: [],
      corrections: [],
      answersExpectedField: false,
      confidence: 0.9,
    },
    expectAction: "execute",
    expectTask: "certificate",
  },
  {
    label: "olvidate GPS",
    message: "Olvidate del GPS.",
    interp: {
      userAct: "cancellation",
      relation: "cancel",
      normalizedMeaning: "Cancela GPS.",
      requests: [],
      references: [],
      corrections: [],
      answersExpectedField: false,
      confidence: 0.9,
    },
    expectAction: "cancel",
  },
  {
    label: "eso después horómetro",
    message: "Eso después; ahora actualizá el horómetro.",
    interp: {
      userAct: "request",
      relation: "replace",
      normalizedMeaning: "Pospone GPS y actualiza horómetro.",
      requests: [{ serviceId: "hourmeter.prepare", domain: "hourmeter", goal: "hs", entities: {} }],
      references: [],
      corrections: [],
      answersExpectedField: false,
      confidence: 0.92,
    },
    expectAction: "execute",
    expectTask: "hourmeter",
  },
  {
    label: "lateral otra unidad",
    message: "No, pará, quiero ver dónde está la otra.",
    setup: (s) => {
      s.unit = { movilId: 2, plate: "BB", name: "M2", label: "BB (M2)" };
      s.previousUnit = { movilId: 1, plate: "AA", name: "M1", label: "AA (M1)" };
    },
    interp: {
      userAct: "question",
      relation: "side_question",
      normalizedMeaning: "Pregunta ubicación otra unidad.",
      requests: [{ serviceId: "gps.status", domain: "gps", goal: "ubicación", entities: {} }],
      references: [{ type: "unit", expression: "la otra", source: "previous" }],
      corrections: [],
      answersExpectedField: false,
      confidence: 0.88,
    },
    expectAction: "execute",
  },
];

describe("explicit task change", () => {
  for (const c of cases) {
    it(c.label, () => {
      const state = gpsOpen();
      if (c.setup) c.setup(state);
      if (c.interp.relation === "switch" || c.interp.relation === "replace") {
        assert.equal(isExplicitTaskChange(c.interp), true);
      }
      const d = decideTurn({ interpretation: c.interp, state, message: c.message });
      assert.equal(d.action, c.expectAction);
      if (c.expectTask) assert.equal(d.task, c.expectTask);
      if (c.expectAction === "execute" && c.expectTask) {
        assert.notEqual(d.action, "keep_or_close");
      }
    });
  }
});
