#!/usr/bin/env node
/**
 * Cuaderno de sesión — resolveContextUnitPlate, horómetro vs odómetro.
 */
import assert from "node:assert";

let passed = 0;
function check(label, cond) {
  assert.ok(cond, label);
  passed++;
  console.log(`  ✓ ${label}`);
}

const {
  resolveContextUnitPlate,
  resolveMeterNotebookType,
  notebookIndicatesHorometerFlow,
} = await import("../src/lib/conversationNotebook.ts");

check(
  "cuaderno gana sobre activeUnit",
  resolveContextUnitPlate({
    sessionNotebook: { version: 1, updatedAt: new Date().toISOString(), unitFocus: { plate: "AE483VE", updatedAt: "" } },
    activeUnitPlate: "OST223",
  }) === "AE483VE",
);

check(
  "fallback a activeUnit sin cuaderno",
  resolveContextUnitPlate({
    sessionNotebook: null,
    activeUnitPlate: "AG562SP",
  }) === "AG562SP",
);

check(
  "sin contexto devuelve null",
  resolveContextUnitPlate({ sessionNotebook: null, activeUnitPlate: null }) === null,
);

check(
  "horometro como tipo de trámite",
  resolveMeterNotebookType({ horometerFlowActive: true }) === "horometro",
);

check(
  "odometro cuando no es horometro",
  resolveMeterNotebookType({ horometerFlowActive: false, horometerOnlyIntent: false }) === "odometro",
);

check(
  "cuaderno awaiting horometro_value",
  notebookIndicatesHorometerFlow({
    version: 1,
    updatedAt: new Date().toISOString(),
    awaiting: "horometro_value",
    tramite: { type: "horometro", plate: "OST224" },
  }),
);

check(
  "cuaderno odometro no es horometro",
  !notebookIndicatesHorometerFlow({
    version: 1,
    updatedAt: new Date().toISOString(),
    awaiting: "odometro_value",
    intent: "odometro",
  }),
);

console.log(`\n✅ ${passed} checks pasaron.`);
