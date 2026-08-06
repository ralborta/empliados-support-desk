#!/usr/bin/env node
/**
 * Regresión: casi TODO mensaje va a la IA (gate siempre on).
 * No llama a OpenAI: solo gates determinísticos.
 */
import {
  clarificationFromUnderstanding,
  shouldAnswerOpenCaseFromUnderstanding,
  shouldInterpretAmbiguousUtterance,
  shouldProceedAsVehicleUnit,
} from "../src/lib/utteranceUnderstanding.ts";

let failed = 0;
function assert(cond, label) {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`OK: ${label}`);
  }
}

console.log("— Siempre interpreta (diálogo → IA) —");
for (const s of [
  "NRO",
  "nro 12",
  "OST",
  "tks",
  "gracias",
  "si",
  "CONFIRMO",
  "1",
  "patente",
  "pasame la patente",
  "pantentee",
  "empieza con NRO",
  "Quiero hacer un cambio de odómetro",
  "AG 562 SP",
  "cual es el nro de ticket que esta generado por esto?",
  "necesto ayuda",
]) {
  assert(shouldInterpretAmbiguousUtterance(s), `${JSON.stringify(s)} → IA`);
}

assert(!shouldInterpretAmbiguousUtterance(""), "vacío → no");
assert(!shouldInterpretAmbiguousUtterance("x".repeat(300)), "demasiado largo → no");

console.log("\n— Aclaración —");
assert(
  clarificationFromUnderstanding({
    referent: "unclear",
    confidence: 0.5,
    clarifyQuestion: "¿A qué te referís con NRO?",
  }) === "¿A qué te referís con NRO?",
  "unclear aclara",
);
assert(
  clarificationFromUnderstanding(
    { referent: "confirmation", confidence: 0.95, clarifyQuestion: null },
    "CONFIRMO",
  ) === null,
  "confirmation clara → no aclara (ejecuta trámite)",
);
assert(
  clarificationFromUnderstanding(
    { referent: "new_request", confidence: 0.9, clarifyQuestion: null },
    "quiero odómetro",
  ) === null,
  "new_request → no aclara",
);
assert(
  !!clarificationFromUnderstanding(
    { referent: "admin_number", confidence: 0.9, clarifyQuestion: null },
    "NRO",
  ),
  "NRO suelto → aclara",
);
assert(
  clarificationFromUnderstanding(
    { referent: "admin_number", confidence: 0.9, clarifyQuestion: null },
    "cual es el nro de ticket?",
  ) === null,
  "admin_number + ticket → caso",
);

console.log("\n— Caso / unidad —");
assert(
  shouldAnswerOpenCaseFromUnderstanding(
    { referent: "admin_number", confidence: 0.95, clarifyQuestion: null },
    "cual es el nro de ticket?",
  ),
  "responde caso",
);
assert(
  shouldProceedAsVehicleUnit({ referent: "vehicle_unit", confidence: 0.9, clarifyQuestion: null }),
  "vehicle_unit proceed",
);
assert(
  !shouldProceedAsVehicleUnit({ referent: "admin_number", confidence: 0.9, clarifyQuestion: null }),
  "admin_number no flota",
);
assert(shouldProceedAsVehicleUnit(null), "sin IA → reglas");

if (failed > 0) {
  console.error(`\n✗ ${failed} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ utteranceUnderstanding: diálogo → IA OK");
