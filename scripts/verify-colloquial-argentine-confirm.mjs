#!/usr/bin/env node
/**
 * Coloquial rioplatense en confirmaciones: interpretar porfa, joya, avanzame, typos, etc.
 */
import assert from "node:assert/strict";

const {
  looksLikeBriefConfirmation,
  looksLikeColloquialArgentineAffirmation,
} = await import("../src/lib/wara.ts");

const affirm = [
  "porfa",
  "dale porfa",
  "si porfis",
  "joya",
  "genial",
  "barbaro",
  "obvio",
  "de una",
  "metele",
  "avanzame",
  "vancame",
  "bamcame",
  "dale nomás",
  "hacelo",
  "registralo",
];

for (const text of affirm) {
  assert.equal(
    looksLikeColloquialArgentineAffirmation(text),
    true,
    `afirmación coloquial: ${text}`,
  );
  assert.equal(looksLikeBriefConfirmation(text), true, `brief confirm: ${text}`);
}

const notAffirm = ["bancame", "bancame un toque", "gracias", "no confirmo", "cancelar"];

for (const text of notAffirm) {
  assert.equal(
    looksLikeColloquialArgentineAffirmation(text),
    false,
    `NO afirmación: ${text}`,
  );
}

console.log("OK verify-colloquial-argentine-confirm");
