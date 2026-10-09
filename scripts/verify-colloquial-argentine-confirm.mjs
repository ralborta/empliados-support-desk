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
  // Typos de CONFIRMO (bug real 2026-08-21: se tomaba como detalle)
  "comnfirmo",
  "confimo",
  "confimro",
];

for (const text of affirm) {
  assert.equal(
    looksLikeColloquialArgentineAffirmation(text) || looksLikeBriefConfirmation(text),
    true,
    `afirmación coloquial o brief: ${text}`,
  );
  assert.equal(looksLikeBriefConfirmation(text), true, `brief confirm: ${text}`);
}

const {
  looksLikePendingConfirmHelpOrConfusion,
} = await import("../src/lib/wara.ts");

for (const help of [
  "como puedo hacer?",
  "no entiendo que queres hacer?",
  "no entiendo",
  "que hago?",
]) {
  assert.equal(
    looksLikePendingConfirmHelpOrConfusion(help),
    true,
    `help/confusion: ${help}`,
  );
  assert.equal(looksLikeBriefConfirmation(help), false, `help no es CONFIRMO: ${help}`);
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
