#!/usr/bin/env node
/**
 * Laterales tipadas durante odómetro/CONFIRMO: empresa activa sin perder trámite.
 */
import assert from "node:assert/strict";

const {
  classifyTypedLateralQuery,
  tramiteAllowsTypedLateralOverlay,
  shouldSkipTypedLateralForOdometerFlow,
} = await import("../src/lib/typedLateralQueries.ts");

const {
  classifyOdometerFlowSideQuestion,
} = await import("../src/lib/pendingConfirmStance.ts");

const { buildCompanyStatusReply } = await import("../src/lib/waraApi.ts");

const threadAfterUnitAsk = [
  "Cliente: odometro",
  "Atilio: Para registrar el cambio de odómetro, necesito la patente de la unidad. ¿Cuál es?",
].join("\n");

const threadPendingConfirm =
  threadAfterUnitAsk +
  "\nAtilio: Voy a registrar:\nPatente: AC 574 AA\nOdómetro: 97880 km\nRespondé CONFIRMO para registrar.";

assert.equal(classifyTypedLateralQuery("¿qué empresa tengo activa?"), "company_status");
assert.equal(
  classifyTypedLateralQuery("Quiero saber en qué empresa estoy operando"),
  "company_status",
);
assert.equal(classifyTypedLateralQuery("como funciona el modulo opciones"), "platform_opciones");
assert.equal(classifyTypedLateralQuery("quiero saber el estado de la nissan"), "gps_unit_status");
assert.equal(classifyTypedLateralQuery("no reporta la AC 574"), "gps_unit_status");
assert.equal(classifyTypedLateralQuery("900079"), null, "interno operativo no es lateral GPS");
assert.equal(classifyTypedLateralQuery("Cuanto tarda?"), null, "genérico sin patrón tipado");

assert.equal(tramiteAllowsTypedLateralOverlay(threadAfterUnitAsk, null), true);
assert.equal(tramiteAllowsTypedLateralOverlay(threadPendingConfirm, null), true);
assert.equal(shouldSkipTypedLateralForOdometerFlow("900097", threadAfterUnitAsk), true);
assert.equal(
  classifyOdometerFlowSideQuestion("¿qué empresa tengo activa?", threadAfterUnitAsk),
  null,
  "empresa tipada no pasa por heurística odómetro genérica",
);
assert.equal(
  classifyOdometerFlowSideQuestion("Cuanto tarda?", threadAfterUnitAsk),
  null,
  "sin heurística ? genérica",
);

const companyReply = buildCompanyStatusReply("El Cacique S.A.", 1, "");
assert.match(companyReply, /El Cacique/i);

console.log("OK verify-typed-lateral-during-tramite");
