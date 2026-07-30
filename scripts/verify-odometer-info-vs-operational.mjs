#!/usr/bin/env node
/**
 * Regresión bug real 2026-07-30 (captura AD 578 WS):
 * "para q sirve el cambio de odometro?" debe ir a guía informativa, NO arrancar trámite.
 *
 * Uso: npx tsx scripts/verify-odometer-info-vs-operational.mjs
 */
import {
  looksLikeOdometerInfoRequest,
  looksLikeOdometerIntentStart,
  looksLikeExplicitOdometerUpdateRequest,
} from "../src/lib/wara.ts";
import { classifyTurnExecutor } from "../src/lib/whatsappTurnRouter.ts";
import { buildInfoGuideReply } from "../src/lib/infoGuideReplies.ts";

let failed = 0;
function assert(cond, label) {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}

const infoQuestions = [
  "para q sirve el cambio de odometro?",
  "para q sirve el cambio de odometro, me explicas?",
  "que es el cambio de odometro",
  "como funciona el odometro en wara",
];

const operationalStarts = [
  "Podemos cambiar el odometro?",
  "Quiero modificar el odometro",
  "Necesito actualizar el odometro",
];

console.log("— Preguntas informativas —");
for (const text of infoQuestions) {
  assert(looksLikeOdometerInfoRequest(text), `looksLikeOdometerInfoRequest("${text}")`);
  assert(!looksLikeOdometerIntentStart(text), `NO looksLikeOdometerIntentStart("${text}")`);
  assert(
    !looksLikeExplicitOdometerUpdateRequest(text),
    `NO looksLikeExplicitOdometerUpdateRequest("${text}")`,
  );
  assert(
    classifyTurnExecutor(text, "") === "info_guides",
    `classifyTurnExecutor("${text}") → info_guides`,
  );
  const reply = buildInfoGuideReply(text);
  assert(
    /cambio de od[oó]metro|cambio de odometro/i.test(reply) && !/CONFIRMO|nuevo od[oó]metro en km/i.test(reply),
    `buildInfoGuideReply explica sin pedir km ("${text.slice(0, 40)}...")`,
  );
}

console.log("\n— Arranques operativos (no deben confundirse) —");
for (const text of operationalStarts) {
  assert(!looksLikeOdometerInfoRequest(text), `NO info request ("${text}")`);
  assert(
    looksLikeExplicitOdometerUpdateRequest(text),
    `looksLikeExplicitOdometerUpdateRequest("${text}")`,
  );
  assert(
    classifyTurnExecutor(text, "") === "odometro",
    `classifyTurnExecutor("${text}") → odometro`,
  );
}

if (failed > 0) {
  console.error(`\n✗ ${failed} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ Odómetro informativo vs operativo OK");
