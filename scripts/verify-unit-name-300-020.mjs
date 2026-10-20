#!/usr/bin/env node
/**
 * Bug real 2026-08-18: el cliente escribió solo «300-020» y el bot preguntó
 * «¿eso es el nombre de la unidad o la patente?». Es un código interno
 * (M300-020); hay que buscarlo en la flota sin pedir esa aclaración.
 */
import assert from "node:assert/strict";
import {
  filterUnitsByUnitName,
  looksLikeDefiniteUnitNameCode,
  looksLikeUnitNameInMessage,
  replyForUnresolvedUnitCodeToken,
  resolveUnitQuery,
} from "../src/lib/waraUnitIntent.ts";

const fleet = [
  { movil_id: 1, patente: "AD 427 MC", unidad: "M300-020" },
  { movil_id: 2, patente: "AH 755 SM", unidad: "M600-006" },
];

assert.equal(looksLikeUnitNameInMessage("300-020"), true);
assert.equal(looksLikeDefiniteUnitNameCode("300-020"), true);
assert.equal(looksLikeDefiniteUnitNameCode("M300-020"), true);

const byName = filterUnitsByUnitName(fleet, "300-020");
assert.equal(byName.length, 1);
assert.equal(byName[0].patente, "AD 427 MC");

const padded = filterUnitsByUnitName(
  [{ movil_id: 9, patente: "XX123YY", unidad: "M300-20" }],
  "300-020",
);
assert.equal(padded.length, 1, "300-020 ≡ M300-20 (cero a la izquierda)");

const resolved = await resolveUnitQuery({
  rawText: "300-020",
  threadText: "Dale, pasame la matrícula de la unidad (ej. AD427MC).",
  units: fleet,
});
assert.equal(resolved.intent, "consult_status");
assert.equal(String(resolved.plate).replace(/\s+/g, ""), "AD427MC");
assert.doesNotMatch(String(resolved.clarificationQuestion ?? ""), /Respondé \*unidad\*/i);

const missing = await resolveUnitQuery({
  rawText: "300-020",
  threadText: "",
  units: fleet.filter((u) => u.movil_id !== 1),
});
assert.equal(missing.intent, "need_clarification");
assert.match(String(missing.clarificationQuestion), /300-020/);
assert.match(String(missing.clarificationQuestion), /no encontr/i);
assert.doesNotMatch(String(missing.clarificationQuestion), /Respondé \*unidad\*/i);

const reply = replyForUnresolvedUnitCodeToken("300-020");
assert.match(reply, /300-020/);
assert.doesNotMatch(reply, /Respondé \*unidad\*/i);

console.log("OK verify-unit-name-300-020");
