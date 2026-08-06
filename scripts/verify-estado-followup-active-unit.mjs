#!/usr/bin/env node
/**
 * Bug real 2026-08-06: NKL961 → "contame qué problema" → "Quiero el estado"
 * pedía de nuevo la matrícula (perdía el hilo de la unidad activa).
 */
import {
  looksLikeGpsOrUnitStatusQuestion,
  looksLikeLiveUnitConsultIntent,
  looksLikeUnitConsultFollowUp,
  threadHasRecentUnitProblemListenPrompt,
} from "../src/lib/waraApi.ts";

let failed = 0;
function assert(cond, label) {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}

const follow = "Quiero el estado";
assert(looksLikeGpsOrUnitStatusQuestion(follow), '"Quiero el estado" es pregunta de estado/GPS');
assert(looksLikeLiveUnitConsultIntent(follow), '"Quiero el estado" es consulta en vivo');
assert(looksLikeUnitConsultFollowUp(follow), '"Quiero el estado" es follow-up de unidad');

const listenThread =
  "Cliente: NKL961\n" +
  "Bot: Con la unidad NKL 961 (M300-114), contame qué problema estás viendo: " +
  "¿no reporta ahora, no ves movimiento en el historial, hay un tema con la ignición, o algo más?";
assert(
  threadHasRecentUnitProblemListenPrompt(listenThread),
  "hilo con 'contame qué problema' se detecta",
);

// No debe pedir matrícula de nuevo: el follow-up + listen + activeUnit cubren el caso.
assert(
  looksLikeLiveUnitConsultIntent(follow) ||
    looksLikeUnitConsultFollowUp(follow) ||
    threadHasRecentUnitProblemListenPrompt(listenThread),
  "con unidad activa el follow-up mantiene el hilo",
);

if (failed > 0) {
  console.error(`\n✗ ${failed} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ 'Quiero el estado' tras patente mantiene el hilo");
