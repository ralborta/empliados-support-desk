#!/usr/bin/env node
/**
 * Pivot estado/GPS durante horómetro/odómetro: precedencia, fork y respuestas.
 */
import assert from "node:assert/strict";

const {
  isOperationalMeterCollectionMessage,
  isExplicitUnitStatusQuery,
  statusIntentOverridesMeterOperationalParse,
} = await import("../src/lib/tramiteMeterPrecedence.ts");

const {
  buildPivotIntentFromStatusText,
  classifyPivotForkChoiceResponse,
  extractTramiteUnitAnchorFromThread,
  pivotTargetsSameTramiteUnit,
  buildCrossUnitPivotForkMessage,
  buildResumeTurnLayerPatch,
  pivotCompanyStillValid,
  isPivotIntentFresh,
} = await import("../src/lib/tramitePivot.ts");

const { threadAwaitingTramiteForkChoice } = await import("../src/lib/turnLayerContract.ts");

const { classifyTypedLateralQuery, shouldSkipTypedLateralForOdometerFlow } = await import(
  "../src/lib/typedLateralQueries.ts",
);

const threadHoroNkl = [
  "Cliente: Ok ahora cambio de horometro",
  "Atilio: ⏱ *Horómetro*",
  "",
  "🚗 *Unidad:* NKL 961",
  "",
  "📋 *Datos operativos del horómetro*",
  "Pasame el nuevo horómetro en horas y la fecha/hora de la lectura.",
].join("\n");

const threadAwaitingUnit = [
  "Cliente: odometro",
  "Atilio: Para registrar el cambio de odómetro, necesito la patente de la unidad. ¿Cuál es?",
].join("\n");

// Precedencia: estado explícito gana sobre interno
assert.equal(isExplicitUnitStatusQuery("Estado de la unidad 900088"), true);
assert.equal(statusIntentOverridesMeterOperationalParse("Estado de la unidad 900088"), true);
assert.equal(
  isOperationalMeterCollectionMessage("Estado de la unidad 900088", threadHoroNkl),
  false,
);
assert.equal(classifyTypedLateralQuery("Estado de la unidad 900088"), "gps_unit_status");
assert.equal(
  shouldSkipTypedLateralForOdometerFlow("Estado de la unidad 900088", threadHoroNkl),
  false,
);

// Dato operativo cuando corresponde
assert.equal(isOperationalMeterCollectionMessage("900088", threadAwaitingUnit), true);
assert.equal(shouldSkipTypedLateralForOdometerFlow("900088", threadAwaitingUnit), true);
assert.equal(
  isOperationalMeterCollectionMessage("1250", threadHoroNkl),
  true,
  "valor horas cuando pide datos operativos",
);

// Pivot intent
const pivot = buildPivotIntentFromStatusText("Estado de la unidad 900088", 42);
assert.ok(pivot);
assert.equal(pivot.unitRef.kind, "internal");
assert.equal(pivot.unitRef.value, "900088");
assert.equal(pivot.companyContactId, 42);
assert.equal(isPivotIntentFresh(pivot), true);

const tramite = extractTramiteUnitAnchorFromThread(threadHoroNkl);
assert.ok(tramite);
assert.equal(tramite.plate, "NKL961");
assert.equal(pivotTargetsSameTramiteUnit(tramite, pivot), false);

const forkMsg = buildCrossUnitPivotForkMessage(threadHoroNkl, tramite, pivot);
assert.match(forkMsg, /NKL 961/i);
assert.match(forkMsg, /900088|interno 900088/i);
assert.match(forkMsg, /Consultar ahora/i);
assert.match(forkMsg, /Seguir con hor[oó]metro/i);
assert.equal(threadAwaitingTramiteForkChoice(`${threadHoroNkl}\nAtilio: ${forkMsg}`), true);

// Fork choice labels
assert.equal(classifyPivotForkChoiceResponse("consultar ahora"), "switch");
assert.equal(classifyPivotForkChoiceResponse("seguir con horometro"), "resume");
assert.equal(classifyPivotForkChoiceResponse("consultar ahora y también seguir con horometro"), "ambiguous");

// Misma unidad → lateral (no fork en prepare — probamos matcher)
const pivotSame = buildPivotIntentFromStatusText("Estado de NKL 961", 42);
assert.ok(pivotSame);
assert.equal(pivotTargetsSameTramiteUnit(tramite, pivotSame), true);

// Resume restaura pausedExpectation
const resumePatch = buildResumeTurnLayerPatch({
  type: "odometro",
  createdAt: new Date().toISOString(),
  payload: {
    turnLayer: {
      activeExpectation: "fork_choice",
      pausedExpectation: "fecha_hora",
      forkPending: true,
    },
  },
});
assert.equal(resumePatch.activeExpectation, "fecha_hora");
assert.equal(resumePatch.forkPending, false);

// Invalidación empresa
assert.equal(pivotCompanyStillValid({ ...pivot, companyContactId: 1 }, 1), true);
assert.equal(pivotCompanyStillValid({ ...pivot, companyContactId: 1 }, 2), false);

console.log("OK verify-tramite-pivot-fork");
