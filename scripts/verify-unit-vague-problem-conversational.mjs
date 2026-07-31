#!/usr/bin/env node
/**
 * Regresión — consultas de unidad conversacionales (producción 2026-07-29+):
 * el bot debe ESCUCHAR antes de diagnosticar GPS o cerrar sin ticket.
 *
 * Uso: npx tsx scripts/verify-unit-vague-problem-conversational.mjs
 */
import assert from "node:assert";
import {
  looksLikeVagueUnitProblemReport,
  looksLikeRouteHistoryOrMovementIssue,
  looksLikeProblemClarificationPushback,
  looksLikeConversationalUnitConcern,
  looksLikeNonFleetScopedProblem,
  resolveConversationalUnitTurn,
  threadHasRecentGpsStatusSummary,
} from "../src/lib/waraApi.ts";
import { classifyTurnExecutor } from "../src/lib/whatsappTurnRouter.ts";
import { shouldRouteTurnToUnidadesExecutor } from "../src/lib/waraUnitIntent.ts";

let passed = 0;
function check(label, cond) {
  assert.ok(cond, label);
  passed++;
  console.log(`  ✓ ${label}`);
}

const label = "AG 562 SP (NISSAN 2404 - AG 562 SP)";

console.log("— Problema vago (muchas formas) —");
for (const text of [
  "sabes q tengo un problema con la nissan",
  "algo raro con la hilux",
  "tengo un tema con esa unidad",
  "que pasa con el ford",
  "no entiendo que pasa con la camioneta",
  "me preocupa la sprinter",
]) {
  check(`vago: "${text.slice(0, 40)}..."`, looksLikeVagueUnitProblemReport(text) === true);
}

console.log("\n— NO confundir con GPS concreto ni administrativo —");
check(
  'GPS concreto NO es vago ("no reporta la nissan")',
  looksLikeVagueUnitProblemReport("la nissan no reporta desde ayer") === false,
);
check(
  "problema de cuenta → administrativo, no unidad",
  looksLikeNonFleetScopedProblem("tengo un problema con mi cuenta") === true &&
    looksLikeVagueUnitProblemReport("tengo un problema con mi cuenta") === false,
);
check(
  "problema facturación → odoo, no vago unidad",
  classifyTurnExecutor("tengo un problema de facturacion", "") === "odoo_ticket",
);

console.log("\n— Historial / recorrido (distintos contextos) —");
for (const text of [
  "veo q ayer no me muestra movimiento",
  "ayer fue a un cliente y no logro ver ese recorrido",
  "el lunes no figura el recorrido en el mapa",
  "semana pasada no hay actividad",
  "anoche salio y no veo paradas",
  "no me aparece en el historial lo de ayer",
]) {
  check(`historial: "${text.slice(0, 42)}..."`, looksLikeRouteHistoryOrMovementIssue(text) === true);
}

console.log("\n— Pushback del cliente —");
for (const text of [
  "pero si ni te dije cual es mi problema!",
  "repetis lo mismo no me ayudaste",
  "no entendiste lo que te pregunte",
]) {
  check(`pushback: "${text}"`, looksLikeProblemClarificationPushback(text) === true);
}

console.log("\n— Umbrella conversacional —");
check(
  "looksLikeConversationalUnitConcern cubre vago + historial + pushback",
  looksLikeConversationalUnitConcern("algo raro con la hilux") &&
    looksLikeConversationalUnitConcern("ayer no veo el recorrido") &&
    looksLikeConversationalUnitConcern("ni te dije cual es mi problema"),
);

console.log("\n— Respuesta conversacional (no GPS automático) —");
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
check(
  "follow-up sin unidad en mensaje pero GPS ya explicado → historial",
  resolveConversationalUnitTurn({
    rawText: "veo que ayer no me muestra movimiento",
    threadText:
      "La unidad AG 562 SP está detenida. La ignición está apagada. No se generará un ticket por el momento.",
    unitLabel: label,
  })?.includes("HISTORIAL"),
);

console.log("\n— Horómetro tras GPS: NO loop conversacional —");
const gpsThread =
  "Cliente: Quiero cambiar el horometro de la Nissan\nBot: La unidad AG 562 SP (NISSAN 2404) está detenida y con la ignición apagada, por eso no está actualizando su ubicación. No se generó un ticket por este estado.";
check(
  "horómetro explícito tras GPS → null (va a trámite odómetro)",
  resolveConversationalUnitTurn({
    rawText: "quiero cambiar el horometro",
    threadText: gpsThread,
    unitLabel: label,
  }) === null,
);
check(
  'classifyTurnExecutor("Quiero cambiar el horometro de la Nissan") === "odometro" tras GPS',
  classifyTurnExecutor("Quiero cambiar el horometro de la Nissan", gpsThread) === "odometro",
);
check(
  "horómetro + Nissan tras GPS → NO shouldRouteTurnToUnidadesExecutor",
  shouldRouteTurnToUnidadesExecutor({
    selectionText: "Quiero cambiar el horometro de la Nissan",
    threadText: gpsThread,
  }) === false,
);

console.log("\n— Router: concern conversacional va a unidades —");
check(
  'classifyTurnExecutor("algo raro con la hilux") === "unidades"',
  classifyTurnExecutor("algo raro con la hilux", "") === "unidades",
);

console.log("\n— Detección de GPS ya explicado en hilo —");
check(
  "threadHasRecentGpsStatusSummary detecta respuesta detenida previa",
  threadHasRecentGpsStatusSummary(
    "La unidad AG 562 SP está detenida. La ignición está apagada. No se generará un ticket por el momento.",
  ) === true,
);

console.log(`\n✅ ${passed} checks pasaron.`);
