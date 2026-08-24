#!/usr/bin/env node
/**
 * Pivot / interferencia: lectura GPS → overlay (no fork). Escritura → fork.
 * Sin try/catch permisivos en asserts críticos.
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
  prepareStatusPivotDuringTramite,
} = await import("../src/lib/tramitePivot.ts");

const { threadAwaitingTramiteForkChoice, looksLikeExplicitOtherTramiteIntent } = await import(
  "../src/lib/turnLayerContract.ts"
);

const { classifyTypedLateralQuery, shouldSkipTypedLateralForOdometerFlow } = await import(
  "../src/lib/typedLateralQueries.ts"
);

const { decidePendingWriteInterference, composeOverlayReadKeepPendingReply } = await import(
  "../src/lib/pendingWriteInterference.ts"
);

const {
  actionRiskFromUnderstanding,
  shouldClarifyUnitWithoutStatusAction,
} = await import("../src/lib/utteranceUnderstanding.ts");

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

assert.equal(isOperationalMeterCollectionMessage("900088", threadAwaitingUnit), true);
assert.equal(shouldSkipTypedLateralForOdometerFlow("900088", threadAwaitingUnit), true);
assert.equal(isOperationalMeterCollectionMessage("1250", threadHoroNkl), true);

const pivot = buildPivotIntentFromStatusText("Estado de la unidad 900088", 42);
assert.ok(pivot);
assert.equal(pivot.unitRef.kind, "internal");
assert.equal(pivot.unitRef.value, "900088");
assert.equal(isPivotIntentFresh(pivot), true);

const tramite = extractTramiteUnitAnchorFromThread(threadHoroNkl);
assert.ok(tramite);
assert.equal(tramite.plate, "NKL961");
assert.equal(pivotTargetsSameTramiteUnit(tramite, pivot), false);

assert.equal(
  decidePendingWriteInterference({
    hasPendingWrite: true,
    incomingActionRisk: "read",
    incomingMatchesExpectedField: false,
  }),
  "overlay_read_keep_pending",
);
assert.doesNotMatch(
  composeOverlayReadKeepPendingReply(
    "AH 652 KW — telemetría ok.",
    "El cambio de horómetro de NKL 961 sigue pendiente; podés continuar enviando las horas.",
  ),
  /¿seguimos/i,
);

const pivotPrep = await prepareStatusPivotDuringTramite({
  prisma: {
    customer: {
      findFirst: async () => ({
        id: "c1",
        phone: "5491100000000",
        selectedCompanyContactId: 42,
        companyName: "Test",
      }),
      findUnique: async () => null,
      update: async () => ({}),
    },
  },
  rawPhone: "5491100000000",
  selectionText: "Estado de la unidad 900088",
  threadText: threadHoroNkl,
  pendingAction: {
    type: "odometro",
    createdAt: new Date().toISOString(),
    payload: { plate: "NKL961", turnLayer: { activeExpectation: "km", forkPending: false } },
  },
});
assert.ok(pivotPrep);
assert.notEqual(pivotPrep.kind, "fork");
assert.ok(
  pivotPrep.kind === "overlay_read" || pivotPrep.kind === "same_unit_lateral",
  `got ${pivotPrep.kind}`,
);

const pivotSame = buildPivotIntentFromStatusText("Estado de NKL 961", 42);
assert.ok(pivotSame);
assert.equal(pivotTargetsSameTramiteUnit(tramite, pivotSame), true);

assert.equal(looksLikeExplicitOtherTramiteIntent("Certificado 900088"), "certificados");
assert.equal(
  decidePendingWriteInterference({
    hasPendingWrite: true,
    incomingActionRisk: "write",
    incomingMatchesExpectedField: false,
  }),
  "fork_incompatible_write",
);

assert.equal(
  actionRiskFromUnderstanding({
    referent: "vehicle_unit",
    confidence: 0.9,
    clarifyQuestion: null,
    action: "unit_reference",
    unitRef: { kind: "unit_name", value: "900088" },
  }),
  null,
);
assert.equal(
  shouldClarifyUnitWithoutStatusAction({
    referent: "vehicle_unit",
    confidence: 0.9,
    clarifyQuestion: null,
    action: "unit_reference",
    unitRef: { kind: "unit_name", value: "900088" },
  }),
  true,
);

const forkMsg = buildCrossUnitPivotForkMessage(threadHoroNkl, tramite, pivot);
assert.match(forkMsg, /Consultar ahora/i);
assert.equal(threadAwaitingTramiteForkChoice(`${threadHoroNkl}\nAtilio: ${forkMsg}`), true);
assert.equal(classifyPivotForkChoiceResponse("consultar ahora"), "switch");
assert.equal(classifyPivotForkChoiceResponse("seguir con horometro"), "resume");

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
assert.equal(pivotCompanyStillValid({ ...pivot, companyContactId: 1 }, 1), true);
assert.equal(pivotCompanyStillValid({ ...pivot, companyContactId: 1 }, 2), false);

console.log("OK verify-tramite-pivot-fork");
