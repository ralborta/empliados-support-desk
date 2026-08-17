import assert from "node:assert/strict";
import { extractLastPlateFromThread, lineLooksLikeBotMissingPlatePrompt } from "../src/lib/wara.ts";
import { filterUnitsByUnitName } from "../src/lib/waraUnitIntent.ts";

const fleet = [
  {
    movil_id: 900114,
    unidad: "M900-114",
    patente: "AF325RY",
  },
  {
    movil_id: 900111,
    unidad: "M900-111",
    patente: "AG228NY",
  },
];

assert.equal(
  lineLooksLikeBotMissingPlatePrompt(
    "Dale, pasame la matrícula de la unidad (ej. AD427MC).",
  ),
  true,
  "prompt GPS con ejemplo debe ignorarse en el hilo",
);

const thread = [
  "Cliente: Quiero el estado de una unidad",
  "Atilio: Dale, pasame la matrícula de la unidad (ej. AD427MC).",
  "Cliente: 900114",
].join("\n");

assert.equal(
  extractLastPlateFromThread(thread),
  null,
  "extractLastPlateFromThread no debe tomar AD427MC del ejemplo del bot",
);

const byCode = filterUnitsByUnitName(fleet, "900-114");
assert.equal(byCode.length, 1, "900-114 debe resolver M900-114");
assert.equal(byCode[0]?.movil_id, 900114);

console.log("verify-gps-unit-format: OK");
