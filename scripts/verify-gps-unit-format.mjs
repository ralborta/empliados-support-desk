import assert from "node:assert/strict";
import { extractLastPlateFromThread, lineLooksLikeBotMissingPlatePrompt } from "../src/lib/wara.ts";
import {
  extractAmbiguousUnitCodeToken,
  extractMovilIdFromUnitMessage,
  filterUnitsByUnitName,
  resolveUnitQuery,
} from "../src/lib/waraUnitIntent.ts";

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
  {
    movil_id: 900077,
    unidad: "M900-077",
    patente: "AA100ZZ",
  },
];

assert.equal(
  extractMovilIdFromUnitMessage("Quiero el estado de la unidad 900077"),
  900077,
  "debe extraer movil_id del mensaje completo",
);

const resolved = await resolveUnitQuery({
  rawText: "Quiero el estado de la unidad 900077",
  threadText: "",
  units: fleet,
  preferAi: false,
});
assert.equal(resolved.plate, "AA100ZZ", "900077 debe resolver la patente correcta");

const resolvedStringId = await resolveUnitQuery({
  rawText: "Quiero el estado de la unidad 900088",
  threadText: "",
  units: [{ movil_id: "900088", unidad: "M900-088", patente: "AA900088" }],
  preferAi: false,
});
assert.equal(
  resolvedStringId.plate,
  "AA900088",
  "movil_id string de Wara debe matchear igual que number",
);

assert.equal(
  extractAmbiguousUnitCodeToken("Quiero el estado de la unidad 900088"),
  null,
  "movil_id explícito no es token ambiguo unidad-vs-patente",
);

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
