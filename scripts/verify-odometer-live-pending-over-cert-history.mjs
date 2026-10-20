#!/usr/bin/env node
/**
 * Hotfix: pending vivo de odómetro protege campo esperado vs historial de certificado,
 * sin secuestrar consultas laterales / guías / saludos.
 *
 * Casos obligatorios:
 * 1. Certificado viejo → Odómetro → «Sí, en 900173» → odometro (no inventa corregir/actualizar)
 * 2. Odómetro pending → «900173» → nunca certificados
 * 3. Pending esperando km → «900173» → odometro (valor), no unidad/cert
 * 4. Pending odómetro → «necesito certificado de 900173» → certificados
 * 5. «Sí» solo → no inventa corregir/actualizar (sigue odometro / action_choice)
 * 6. Laterales con pending odometro NO van a odometro (informe, HR, hola, GPS)
 *
 * Uso: npx tsx scripts/verify-odometer-live-pending-over-cert-history.mjs
 */
import assert from "node:assert/strict";
import {
  ODOMETER_ACTION_CHOICE_STAGE,
  hasPendingOdometerActionChoice,
  isCompatibleLiveOdometerPendingReply,
  looksLikeBareAffirmationToOdometerActionChoice,
  looksLikeOdometerActionChoiceReply,
  looksLikeOdometerActionChoiceUnitContinuation,
  parseOdometerActionChoice,
} from "../src/lib/odometerActionChoice.ts";
import { classifyTurnExecutor } from "../src/lib/whatsappTurnRouter.ts";
import {
  hasPendingCertificateUnitRequest,
  shouldContinueCertificateUnitCollection,
} from "../src/lib/wara.ts";

const certAwaitingUnitThread = [
  "Cliente: Quiero un certificado",
  "Atilio: Para generar el certificado, necesito que me confirmes la patente de la unidad. ¿Cuál es?",
].join("\n");

const afterOdometerClarify = [
  certAwaitingUnitThread,
  "Cliente: Odometro",
  "Atilio: ¿Qué necesitás con el odómetro: corregir o actualizar el kilometraje, o es otra consulta?",
].join("\n");

const pendingActionChoice = {
  type: "odometro",
  payload: {
    stage: ODOMETER_ACTION_CHOICE_STAGE,
    clarifyStage: "clarify_odometer_intent",
  },
  createdAt: new Date().toISOString(),
};

const pendingCollectingKm = {
  type: "odometro",
  payload: {
    stage: "collecting",
    patente: "AD578XY",
    turnLayer: { activeExpectation: "km" },
  },
  createdAt: new Date().toISOString(),
};

console.log("— Autoridad: pending vivo veta historial de certificado —");
assert.equal(
  hasPendingCertificateUnitRequest(certAwaitingUnitThread),
  true,
  "sin pending: historial awaiting_unit sí cuenta",
);
assert.equal(
  hasPendingCertificateUnitRequest(certAwaitingUnitThread, pendingActionChoice),
  false,
  "pending odometro veta historial de certificado",
);
assert.equal(
  shouldContinueCertificateUnitCollection("900173", certAwaitingUnitThread, pendingActionChoice),
  false,
  "900173 con pending odometro NO continúa certificado",
);
assert.equal(
  shouldContinueCertificateUnitCollection("900173", certAwaitingUnitThread, null),
  true,
  "900173 sin pending (historial cert) sí continúa certificado",
);

console.log("\n— Continuación action_choice con unidad (sin inventar choice) —");
assert.equal(looksLikeOdometerActionChoiceUnitContinuation("Si, en 900173"), true);
assert.equal(looksLikeOdometerActionChoiceUnitContinuation("900173"), true);
assert.equal(looksLikeOdometerActionChoiceReply("Si, en 900173"), false);
assert.equal(parseOdometerActionChoice("Si, en 900173"), null);
assert.equal(looksLikeBareAffirmationToOdometerActionChoice("Si"), true);
assert.equal(looksLikeBareAffirmationToOdometerActionChoice("Si, en 900173"), false);
assert.equal(hasPendingOdometerActionChoice(pendingActionChoice), true);

console.log("\n— Routing obligatorio —");
assert.equal(
  classifyTurnExecutor("Si, en 900173", afterOdometerClarify, pendingActionChoice),
  "odometro",
  "1. Cert viejo + Sí, en 900173 → odometro",
);
assert.equal(
  classifyTurnExecutor("900173", afterOdometerClarify, pendingActionChoice),
  "odometro",
  "2. Odómetro pending + 900173 → odometro (nunca certificado)",
);
assert.equal(
  classifyTurnExecutor(
    "900173",
    afterOdometerClarify + "\nAtilio: Pasame el valor del odómetro en km.",
    pendingCollectingKm,
  ),
  "odometro",
  "3. Pending esperando km + 900173 → odometro",
);
assert.equal(
  classifyTurnExecutor(
    "necesito certificado de 900173",
    afterOdometerClarify,
    pendingActionChoice,
  ),
  "certificados",
  "4. Pedido explícito de certificado reemplaza odómetro",
);
assert.equal(
  classifyTurnExecutor("Si", afterOdometerClarify, pendingActionChoice),
  "odometro",
  "5. Sí solo → sigue odometro (no cert); no inventa choice en el parser",
);
assert.equal(parseOdometerActionChoice("Si"), null, "5b. Sí solo no es corregir/actualizar");

console.log("\n— No secuestrar laterales / guías / saludos —");
const mustNotBeOdometro = [
  "¿Cómo veo el informe de cargas de combustible?",
  "¿Cómo creo una hoja de ruta?",
  "hola",
  "¿dónde está la unidad?",
];
for (const msg of mustNotBeOdometro) {
  const got = classifyTurnExecutor(msg, afterOdometerClarify, pendingCollectingKm);
  assert.notEqual(got, "odometro", `lateral «${msg}» no debe ser odometro (got=${got})`);
  assert.equal(
    isCompatibleLiveOdometerPendingReply(msg, pendingCollectingKm, afterOdometerClarify),
    false,
    `«${msg}» no es respuesta compatible de campo`,
  );
}
assert.equal(
  isCompatibleLiveOdometerPendingReply("900173", pendingCollectingKm, afterOdometerClarify),
  true,
  "900173 sí es compatible con expectation km",
);

assert.notEqual(
  classifyTurnExecutor("¿dónde está la unidad?", afterOdometerClarify, pendingCollectingKm),
  "odometro",
  "GPS con pending odometro no queda forzado a odometro",
);

console.log("\n✓ verify-odometer-live-pending-over-cert-history OK");
