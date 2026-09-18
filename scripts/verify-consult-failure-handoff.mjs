#!/usr/bin/env node
/**
 * Bug 2026-08-22/23: “reporte de la nissan” → silencio → “Y?”.
 * Debe haber respuesta natural (disculpa) + derivación a operador, no silencio.
 *
 * Uso: npx tsx scripts/verify-consult-failure-handoff.mjs
 */
import assert from "node:assert/strict";
import {
  looksLikeImpatientConsultFollowUp,
  pickConsultFailureHandoffReply,
  shouldHandoffImpatientUnitConsultFollowUp,
  threadHasRecentUnansweredUnitConsult,
} from "../src/lib/consultFailureHandoff.ts";

assert.equal(looksLikeImpatientConsultFollowUp("Y?"), true);
assert.equal(looksLikeImpatientConsultFollowUp("y"), true);
assert.equal(looksLikeImpatientConsultFollowUp("??"), true);
assert.equal(looksLikeImpatientConsultFollowUp("hola?"), true);
assert.equal(looksLikeImpatientConsultFollowUp("Indícame el reporte de la nissan"), false);

const unanswered = [
  "Atilio: ¡Hola Emii! Claro, estoy aquí para ayudarte.",
  "Cliente: Indícame el reporte de la nissan",
].join("\n");
assert.equal(threadHasRecentUnansweredUnitConsult(unanswered), true, "sin respuesta bot");
assert.equal(
  shouldHandoffImpatientUnitConsultFollowUp("Y?", unanswered),
  true,
  "Y? tras nissan sin GPS → handoff",
);

const withGps = [
  unanswered,
  "Atilio: La unidad AG 562 SP está detenida. La ignición está apagada. No se generará un ticket por ahora.",
].join("\n");
assert.equal(
  shouldHandoffImpatientUnitConsultFollowUp("Y?", withGps),
  false,
  "con resumen GPS no secuestra Y?",
);

const a = pickConsultFailureHandoffReply("5492612478856");
const b = pickConsultFailureHandoffReply("5492612478856");
assert.equal(a, b, "misma semilla mismo día → misma variante");
assert.match(a, /disculp|perdón|perdon/i, "disculpa");
assert.match(a, /operador|asesor/i, "menciona operador/asesor");
assert.doesNotMatch(a, /Disculpa, tenemos problemas en las consultas\.\./i, "no texto quemado literal");

console.log("✓ verify-consult-failure-handoff OK");
