#!/usr/bin/env node
/**
 * Clasificación fleetQueryKind: individual, listado, comparación agregada.
 */
import assert from "node:assert/strict";
import {
  FLEET_QUERY_STATE_CONTRACT,
  buildAggregateFleetComparisonLimitReply,
  classifyFleetQueryKind,
  clarificationPromisesAggregateRankingViaPlate,
} from "../src/lib/fleetQueryKind.ts";
import { clarificationFromUnderstanding } from "../src/lib/utteranceUnderstanding.ts";

assert.equal(FLEET_QUERY_STATE_CONTRACT.version, "2026-08-24");
assert.ok(FLEET_QUERY_STATE_CONTRACT.capability_override.preserves.includes("pendingAction"));

console.log("— aggregate_comparison (estructural, sin frase fija) —");
for (const msg of [
  "¿Cuál es la unidad que tiene más tiempo sin reporte?",
  "Qué unidad de mi flota reporta peor",
  "La que más lleva sin reportar",
  "Cuál unidad tiene mayor tiempo offline",
]) {
  const c = classifyFleetQueryKind(msg);
  assert.equal(c.kind, "aggregate_comparison", `"${msg}" → aggregate`);
  assert.equal(c.scope, "cross_fleet_metric");
}

console.log("— fleet_list —");
assert.equal(classifyFleetQueryKind("listado de mis unidades").kind, "fleet_list");
assert.equal(classifyFleetQueryKind("pasame la lista de flota").kind, "fleet_list");

console.log("— individual_unit —");
assert.equal(
  classifyFleetQueryKind("Quiero el reporte de la Nissan").kind,
  "individual_unit",
);
assert.equal(classifyFleetQueryKind("Estado GPS AG 382 QD").kind, "individual_unit");
assert.equal(
  classifyFleetQueryKind("Quiero saber el reporte de una unidad").kind,
  "individual_unit",
  "consulta genérica sin ranking → individual (pedir unidad)",
);

console.log("— comparación de dos o más unidades → aggregate + límite —");
const limit = buildAggregateFleetComparisonLimitReply();
for (const msg of [
  "Comparar AG 382 QD con AB 111 ZZ",
  "¿Cuál reporta mejor entre AG 382 QD y AB 111 ZZ?",
  "Diferencia de reporte entre esas dos unidades",
]) {
  const c = classifyFleetQueryKind(msg);
  assert.equal(c.kind, "aggregate_comparison", `"${msg}" → aggregate_comparison`);
  assert.equal(c.isComparativeQuestion, true, `"${msg}" es comparativa`);
  assert.match(limit, /unidad por unidad/i, "respuesta de solo unidad por unidad");
}

console.log("— none / capacidades —");
assert.equal(classifyFleetQueryKind("Que gestiones puedo hacer con vos?").kind, "none");

console.log("— respuesta fija de límite —");
assert.match(limit, /unidad por unidad/i);
assert.match(limit, /listado de mis unidades/i);
assert.ok(!/identificar cuál es la unidad/i.test(limit));

console.log("— utterance guard ranking+patente —");
assert.equal(
  clarificationPromisesAggregateRankingViaPlate(
    "Para poder ayudarte a identificar cuál es la unidad que tiene más tiempo sin reporte, necesito que me indiques la patente.",
  ),
  true,
);
assert.equal(
  clarificationPromisesAggregateRankingViaPlate("Pasame la patente de la unidad AG 382 QD"),
  false,
);

console.log("— aclaración individual: anti-ranking solo si rawText es aggregate —");
const rankingStyleClarify =
  "Para poder ayudarte a identificar cuál es la unidad que tiene más tiempo sin reporte, necesito que me indiques la patente.";
const individualMsg = "Quiero el reporte de AG 382 QD";
const individualClarify = clarificationFromUnderstanding(
  {
    referent: "unclear",
    confidence: 0.55,
    clarifyQuestion: rankingStyleClarify,
  },
  individualMsg,
);
assert.notEqual(
  individualClarify,
  buildAggregateFleetComparisonLimitReply(),
  "consulta individual + clarify tipo ranking → NO límite de flota",
);
assert.equal(individualClarify, rankingStyleClarify);

const aggregateClarify = clarificationFromUnderstanding(
  {
    referent: "unclear",
    confidence: 0.55,
    clarifyQuestion: rankingStyleClarify,
  },
  "¿Cuál es la unidad que tiene más tiempo sin reporte?",
);
assert.equal(
  aggregateClarify,
  buildAggregateFleetComparisonLimitReply(),
  "mensaje aggregate → límite aunque la IA pida patente",
);

console.log("\n✓ verify-fleet-query-kind OK");
