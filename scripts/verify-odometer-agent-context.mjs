#!/usr/bin/env node
/**
 * Regresión — modo agente no debe secuestrar trámite de odómetro hacia consulta GPS.
 * Tras listado de flota + varios intentos con patente/prefijo, el turno va a odometro.
 *
 * Uso: npx tsx scripts/verify-odometer-agent-context.mjs
 */
import assert from "node:assert";
import {
  shouldRouteTurnToOdometerExecutor,
  isOdometerPlateSelectionMessage,
} from "../src/lib/waraUnitIntent.ts";
import {
  threadHasActiveOdometerFlow,
  threadHasOdometerUnitClarificationPending,
} from "../src/lib/wara.ts";

let passed = 0;
function check(label, cond) {
  assert.ok(cond, label);
  passed++;
  console.log(`  ✓ ${label}`);
}

const fleetOdoThread = [
  "Cliente: Pásame la lista de mi flota",
  "Atilio: Tenés 414 unidades registradas en El Cacique S.A. Te muestro 8: OST 223, AD 427 MC, MYQ 693...",
  "Cliente: Quiero cambiar el odometro",
  "Atilio: Para registrar el cambio de odómetro necesito la patente de la unidad. ¿Cuál es?",
  "Cliente: La q empieza con OST",
  "Atilio: Encontré 4 unidades que empiezan con OST (OST 223, OST 224...). Decime la patente completa.",
].join("\n");

console.log("— Trámite odómetro sigue activo tras listado + prefijo —");
check("threadHasActiveOdometerFlow", threadHasActiveOdometerFlow(fleetOdoThread) === true);
check(
  "threadHasOdometerUnitClarificationPending",
  threadHasOdometerUnitClarificationPending(fleetOdoThread) === true,
);

console.log("\n— shouldRouteTurnToOdometerExecutor (no agente → unidades/GPS) —");
for (const [msg, label] of [
  ["OST 223", "patente completa"],
  ["La ost", "prefijo corto"],
  ["la q empieza con OST", "prefijo explícito"],
  ["De la misma unidad", "referencia vaga"],
]) {
  check(
    `${label}: "${msg}"`,
    shouldRouteTurnToOdometerExecutor({
      selectionText: msg,
      threadText: fleetOdoThread,
    }) === true,
  );
}

console.log("\n— isOdometerPlateSelectionMessage —");
check('prefijo "OST"', isOdometerPlateSelectionMessage("OST") === true);
check('patente "OST 223"', isOdometerPlateSelectionMessage("OST 223") === true);

console.log("\n— NO secuestrar consulta GPS explícita durante odómetro —");
check(
  'GPS explícito no fuerza odometro si pregunta estado',
  shouldRouteTurnToOdometerExecutor({
    selectionText: "como esta el reporte de la OST 223 ahora",
    threadText: fleetOdoThread,
  }) === false,
);

console.log(`\n✅ ${passed} checks pasaron.`);
