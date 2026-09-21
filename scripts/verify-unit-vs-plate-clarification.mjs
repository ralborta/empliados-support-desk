#!/usr/bin/env node
/**
 * Bug 2026-08-10: "600-006" no es patente 600006.
 * Match en flota → resuelve; código con guión que no está → no encontrado (no pregunta patente).
 */
import assert from "node:assert/strict";
import {
  buildUnitNameOrPlateClarificationReply,
  extractAmbiguousUnitCodeToken,
  extractTokenFromUnitNameOrPlateClarification,
  filterUnitsByUnitName,
  looksLikeAmbiguousUnitCodeToken,
  looksLikeChosePlateReply,
  looksLikeChoseUnitNameReply,
  looksLikeUnitNameInMessage,
  resolveUnitQuery,
  threadAskedUnitNameOrPlateClarification,
} from "../src/lib/waraUnitIntent.ts";
import { isPlausibleVehiclePlate, detectLoosePlate } from "../src/lib/wara.ts";

assert.equal(looksLikeUnitNameInMessage("600-006"), true);
assert.equal(looksLikeAmbiguousUnitCodeToken("600-006"), true);
assert.equal(looksLikeAmbiguousUnitCodeToken("600006"), true);
assert.equal(isPlausibleVehiclePlate("600006"), false);
assert.equal(detectLoosePlate("600-006"), null);
assert.equal(extractAmbiguousUnitCodeToken("600-006"), "600-006");
assert.equal(extractAmbiguousUnitCodeToken("600006"), "600-006");

const fleet = [
  { movil_id: 1, patente: "AH 755 SM", unidad: "M600-006" },
  { movil_id: 2, patente: "AD 427 MC", unidad: "M300-111" },
];
assert.equal(filterUnitsByUnitName(fleet, "600-006").length, 1);

const resolved = await resolveUnitQuery({
  rawText: "600-006",
  threadText: "Dale, pasame la matrícula de la unidad (ej. AD427MC).",
  units: fleet,
});
assert.equal(resolved.intent, "consult_status");
assert.equal(resolved.plate, "AH755SM");

const missing = await resolveUnitQuery({
  rawText: "600-999",
  threadText: "Dale, pasame la matrícula.",
  units: fleet,
});
assert.equal(missing.intent, "need_clarification");
assert.match(String(missing.clarificationQuestion), /600-999/);
assert.match(String(missing.clarificationQuestion), /no encontr/i);
assert.doesNotMatch(String(missing.clarificationQuestion), /Respondé \*unidad\*/i);
assert.doesNotMatch(String(missing.clarificationQuestion), /patente 600/i);

const ask = buildUnitNameOrPlateClarificationReply("600-006");
assert.match(ask, /unidad/);
assert.match(ask, /patente/);
assert.equal(threadAskedUnitNameOrPlateClarification(`Bot: ${ask}`), true);
assert.equal(extractTokenFromUnitNameOrPlateClarification(`Bot: ${ask}`), "600-006");
assert.equal(looksLikeChoseUnitNameReply("unidad"), true);
assert.equal(looksLikeChosePlateReply("patente"), true);

console.log("OK verify-unit-vs-plate-clarification");
