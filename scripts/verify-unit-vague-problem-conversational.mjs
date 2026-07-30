#!/usr/bin/env node
/**
 * Regresión — Bug real, producción 2026-07-29 (Emmanuel / Nissan AG 562 SP):
 *
 *   "sabes q tengo un problema con la nissan" → el bot tiró GPS "detenida" sin escuchar.
 *   "pero si ni te dije cual es mi problema!" → repitió lo mismo.
 *   "veo q ayer no me muestra movimiento" / "ayer fue a un cliente y no logro ver ese recorrido"
 *   → seguía repitiendo GPS en vivo en vez de hablar de HISTORIAL/recorrido.
 *
 * Uso: npx tsx scripts/verify-unit-vague-problem-conversational.mjs
 */
import assert from "node:assert";
import {
  looksLikeVagueUnitProblemReport,
  looksLikeRouteHistoryOrMovementIssue,
  looksLikeProblemClarificationPushback,
  resolveConversationalUnitTurn,
  threadHasRecentGpsStatusSummary,
} from "../src/lib/waraApi.ts";
import { classifyTurnExecutor } from "../src/lib/whatsappTurnRouter.ts";

let passed = 0;
function check(label, cond) {
  assert.ok(cond, label);
  passed++;
  console.log(`  ✓ ${label}`);
}

console.log("— Intención vaga vs GPS concreto —");
check(
  'looksLikeVagueUnitProblemReport("sabes q tengo un problema con la nissan")',
  looksLikeVagueUnitProblemReport("sabes q tengo un problema con la nissan") === true,
);
check(
  'GPS concreto NO es vago ("no reporta la nissan")',
  looksLikeVagueUnitProblemReport("la nissan no reporta desde ayer") === false,
);

console.log("\n— Historial / recorrido —");
check(
  'looksLikeRouteHistoryOrMovementIssue("veo q ayer no me muestra movimiento")',
  looksLikeRouteHistoryOrMovementIssue("veo q ayer no me muestra movimiento") === true,
);
check(
  'looksLikeRouteHistoryOrMovementIssue("ayer fue a un cliente y no logro ver ese recorrido")',
  looksLikeRouteHistoryOrMovementIssue("ayer fue a un cliente y no logro ver ese recorrido") === true,
);

console.log("\n— Pushback del cliente —");
check(
  'looksLikeProblemClarificationPushback("pero si ni te dije cual es mi problema!")',
  looksLikeProblemClarificationPushback("pero si ni te dije cual es mi problema!") === true,
);

console.log("\n— Respuesta conversacional (no GPS automático) —");
const label = "AG 562 SP (NISSAN 2404 - AG 562 SP)";
check(
  "problema vago → pregunta qué ve",
  resolveConversationalUnitTurn({
    rawText: "sabes q tengo un problema con la nissan",
    threadText: "Perfecto, sigo con WARA. ¿En qué te puedo ayudar?",
    unitLabel: label,
  })?.includes("Contame qué ves"),
);
check(
  "pushback → reconoce adelanto",
  resolveConversationalUnitTurn({
    rawText: "pero si ni te dije cual es mi problema!",
    threadText:
      "La unidad AG 562 SP está detenida. La ignición está apagada. No se generará un ticket por ahora.",
    unitLabel: label,
  })?.includes("me adelanté"),
);
check(
  "recorrido ayer → HISTORIAL",
  resolveConversationalUnitTurn({
    rawText: "ayer fue a un cliente y no logro ver ese recorrido",
    threadText: "",
    unitLabel: label,
  })?.includes("HISTORIAL"),
);

console.log("\n— Router: problema vago con marca va a unidades, no ticket —");
check(
  'classifyTurnExecutor("sabes q tengo un problema con la nissan") === "unidades"',
  classifyTurnExecutor("sabes q tengo un problema con la nissan", "") === "unidades",
);

console.log("\n— Detección de GPS ya explicado en hilo —");
check(
  "threadHasRecentGpsStatusSummary detecta respuesta detenida previa",
  threadHasRecentGpsStatusSummary(
    "La unidad AG 562 SP está detenida. La ignición está apagada. No se generará un ticket por ahora.",
  ) === true,
);

console.log(`\n✅ ${passed} checks pasaron.`);
