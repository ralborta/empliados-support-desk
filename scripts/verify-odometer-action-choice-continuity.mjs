#!/usr/bin/env node
/**
 * Regresión bug 2026-08-23: tras certificado + "Odometro" (menú clarify) + "Corregir"
 * el bot debe pedir km/fecha para la unidad activa — nunca silencio ni unidades.
 *
 * Estado: expectativa DB `odometer_action_choice` (no regex sobre texto del bot).
 *
 * Uso: npx tsx scripts/verify-odometer-action-choice-continuity.mjs
 */
import assert from "node:assert/strict";
import {
  ODOMETER_ACTION_CHOICE_STAGE,
  hasPendingOdometerActionChoice,
  looksLikeOdometerActionChoiceReply,
  parseOdometerActionChoice,
  shouldSupersedeOdometerActionChoice,
} from "../src/lib/odometerActionChoice.ts";
import { classifyTurnExecutor } from "../src/lib/whatsappTurnRouter.ts";
import { shouldRouteTurnToOdometerExecutor } from "../src/lib/waraUnitIntent.ts";
import { threadHasActiveOdometerFlow } from "../src/lib/wara.ts";

const certThread = [
  "Cliente: Odometro 900118",
  "Atilio: Unidad: AG 382 QD. Pasame el valor del odómetro en km y la fecha y hora.",
  "Cliente: 128000",
  "Atilio: Valor anotado. Me falta solo la fecha y hora de la lectura.",
  "Cliente: Ayer 18:45",
  "Atilio: Confirmar odometro — AG 382 QD — 128000 km — Respondé CONFIRMO o CANCELAR.",
  "Cliente: Quiero un certificado",
  "Atilio: Voy a generar el certificado para AG 382 QD. ¿Confirmás?",
  "Cliente: Confirmo",
  "Atilio: Listo, certificado para AG 382 QD: https://example.com/cert.pdf",
].join("\n");

const clarifyThread = [
  certThread,
  "Cliente: Odometro",
  "Atilio: Sobre el odómetro de la unidad AG 382 QD, ¿qué necesitás hacer? ¿Corregir o actualizar el kilometraje?",
].join("\n");

const pendingActionChoice = {
  type: "odometro",
  payload: {
    stage: ODOMETER_ACTION_CHOICE_STAGE,
    patente: "AG382QD",
    unitLabel: "AG 382 QD",
    clarifyStage: "clarify_odometer_intent",
  },
  createdAt: new Date().toISOString(),
};

console.log("— Detección de expectativa estructurada —");
assert.equal(hasPendingOdometerActionChoice(pendingActionChoice), true);
assert.equal(hasPendingOdometerActionChoice({ type: "odometro", payload: { stage: "collecting" } }), false);
assert.equal(looksLikeOdometerActionChoiceReply("Corregir"), true);
assert.equal(looksLikeOdometerActionChoiceReply("Actualizar"), true);
assert.equal(parseOdometerActionChoice("corregir el kilometraje"), "corregir");
assert.equal(shouldSupersedeOdometerActionChoice("Quiero un certificado"), true);
assert.equal(shouldSupersedeOdometerActionChoice("Corregir"), false);

console.log("\n— Routing con pendingAction (no inferir del texto del bot) —");
assert.equal(
  classifyTurnExecutor("Corregir", clarifyThread, pendingActionChoice),
  "odometro",
  "Corregir → odometro con odometer_action_choice",
);
assert.equal(
  classifyTurnExecutor("Actualizar", clarifyThread, pendingActionChoice),
  "odometro",
  "Actualizar → odometro",
);
assert.equal(
  classifyTurnExecutor("Corregir", clarifyThread),
  "unidades",
  "sin pendingAction el router no infiere del menú del bot",
);

assert.equal(
  classifyTurnExecutor("Quiero un certificado", clarifyThread, pendingActionChoice),
  "certificados",
  "intención nueva reemplaza expectativa",
);

assert.equal(
  shouldRouteTurnToOdometerExecutor({
    selectionText: "Corregir",
    threadText: clarifyThread,
    pendingActionType: "odometro",
  }),
  true,
  "shouldRouteTurnToOdometerExecutor con pending odometro",
);

const collectingThread = [
  clarifyThread,
  "Cliente: Corregir",
  "Atilio: Pasame el valor del odómetro en km y la fecha y hora de la lectura para AG 382 QD.",
].join("\n");

assert.equal(
  threadHasActiveOdometerFlow(collectingThread),
  true,
  "tras consumir choice y pedir km/fecha el flujo odómetro está activo",
);

console.log("\n✓ Continuidad odometer_action_choice OK");
