#!/usr/bin/env node
/**
 * Mejora pedida por el usuario, 2026-07-29: que el trámite de odómetro/horómetro "se
 * reinicie solo" con el tiempo, en vez de depender ÚNICAMENTE de detectar frases de
 * cierre/cambio de tema en el texto del hilo (que siempre pueden quedar cortas ante una
 * frase nueva no prevista — ver scripts/verify-odometer-stale-confirm-after-close.mjs).
 *
 * Fix en odometro-horometro/route.ts: `hasPendingConfirmInThread` y `pendingOdoConfirm`
 * (las dos señales de "hay una confirmación pendiente real") ahora exigen ADEMÁS que
 * exista un `Customer.pendingAction` vigente de tipo "odometro" en la base
 * (getPendingAction ya tiene un TTL de 45 minutos, ver pendingAction.ts). Si el
 * pendingAction venció o nunca se guardó, no importa qué diga el texto viejo del hilo
 * ("respondé CONFIRMO" todavía visible ahí): NO se trata como confirmación pendiente, y
 * el trámite arranca en blanco solo, sin intervención manual.
 *
 * Este test reimplementa la composición booleana exacta (hasPendingOdometerConfirmation
 * && hasLiveOdometerPendingAction) usando la función real de wara.ts y un pendingAction
 * simulado (sin depender de una conexión real a la base — el TTL de getPendingAction ya
 * tiene su propio test con DB real en verify-pending-action-state.mjs).
 *
 * Uso: npx tsx scripts/verify-odometer-pending-confirm-ttl-gate.mjs
 */
import assert from "node:assert";
import { hasPendingOdometerConfirmation } from "../src/lib/wara.ts";

let passed = 0;
function check(label, cond) {
  assert.ok(cond, label);
  passed++;
  console.log(`  ✓ ${label}`);
}

// Reimplementación exacta del gate agregado en odometro-horometro/route.ts.
function computePendingOdoConfirm(threadText, dbPendingAction) {
  const hasLiveOdometerPendingAction = dbPendingAction?.type === "odometro";
  return hasPendingOdometerConfirmation(threadText) && hasLiveOdometerPendingAction;
}

const threadWithConfirmText = [
  "Perfecto, tomo AD 427 MC. ¿Cuál es el nuevo odómetro en km?",
  "125852",
  "Voy a registrar:\n• Patente: AD 427 MC\n• Odómetro: 125852 km\n\nSi está correcto, respondé CONFIRMO para registrarlo en Wara.",
].join("\n");

console.log("Caso normal — confirmación reciente, con pendingAction vigente\n");
check(
  "hasPendingOdometerConfirmation ya da true por el texto (comportamiento de siempre)",
  hasPendingOdometerConfirmation(threadWithConfirmText) === true,
);
check(
  "Con pendingAction vigente tipo 'odometro', se sigue tratando como pendiente real",
  computePendingOdoConfirm(threadWithConfirmText, { type: "odometro", createdAt: new Date().toISOString() }) === true,
);

console.log("\nCaso vencido — el texto sigue diciendo CONFIRMO pero el pendingAction expiró (TTL 45min)\n");
check(
  "getPendingAction ya devuelve null pasado el TTL (comportamiento existente, ver pendingAction.ts) " +
    "→ acá se simula ese resultado (null)",
  computePendingOdoConfirm(threadWithConfirmText, null) === false,
);

console.log("\nCaso sin pendingAction — nunca se guardó (ticket viejo/legacy) o es de otro trámite\n");
check(
  "pendingAction ausente (null) no se trata como confirmación de odómetro pendiente",
  computePendingOdoConfirm(threadWithConfirmText, null) === false,
);
check(
  "pendingAction de OTRO tipo (certificados) no habilita la confirmación de odómetro",
  computePendingOdoConfirm(threadWithConfirmText, { type: "certificados", createdAt: new Date().toISOString() }) === false,
);

console.log("\nSanity — sin el patrón de confirmación en el texto, da false aunque el pendingAction esté vigente\n");
check(
  "Sin 'Voy a registrar...respondé CONFIRMO' en el hilo, sigue dando false",
  computePendingOdoConfirm("Hola, ¿en qué te puedo ayudar?", { type: "odometro", createdAt: new Date().toISOString() }) === false,
);

console.log(`\n${passed} checks passed.`);
