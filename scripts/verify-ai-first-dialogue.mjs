#!/usr/bin/env node
/**
 * IA-first: menos panfletos heurísticos. Solo menú fijo ante pregunta explícita
 * de capacidades; "otra consulta" / cancelar / ok mid-flujo van al turn.
 */
import assert from "node:assert/strict";
import {
  looksLikeExplicitCapabilityMenuRequest,
  looksLikeExplicitCapabilityQuestion,
  looksLikeGenericCapabilityOrTopicSwitchRequest,
  looksLikeFlowControlCommand,
  looksLikeSoftFlowRestart,
  looksLikeThanksOnlyAcknowledgement,
  looksLikeConversationAcknowledgement,
} from "../src/lib/waraApi.ts";

assert.equal(looksLikeExplicitCapabilityMenuRequest("qué gestiones puedo hacer con vos"), true);
assert.equal(looksLikeExplicitCapabilityMenuRequest("qué puedo gestionar"), true);
assert.equal(looksLikeExplicitCapabilityMenuRequest("QUE MAS PODES HACER"), true);
assert.equal(looksLikeExplicitCapabilityMenuRequest("qué más podés hacer"), true);
assert.equal(looksLikeExplicitCapabilityMenuRequest("qué cosas podés hacer"), true);
assert.equal(looksLikeExplicitCapabilityMenuRequest("qué servicios tenés"), true);
assert.equal(
  looksLikeExplicitCapabilityMenuRequest("Quiero hacer otra consulta"),
  false,
  "otra consulta NO es menú fijo",
);
assert.equal(looksLikeExplicitCapabilityQuestion("Quiero hacer otra consulta"), true);
assert.equal(looksLikeGenericCapabilityOrTopicSwitchRequest("Quiero hacer otra consulta"), true);

assert.equal(looksLikeFlowControlCommand("reiniciar"), true);
assert.equal(looksLikeFlowControlCommand("cancelar"), false, "cancelar → IA, no hard reset");
assert.equal(looksLikeFlowControlCommand("inicio"), false);
assert.equal(looksLikeSoftFlowRestart("inicio"), true);
assert.equal(looksLikeSoftFlowRestart("Volvamos al inicio"), true);
assert.equal(looksLikeSoftFlowRestart("volver al inicio"), true);
assert.equal(looksLikeSoftFlowRestart("Te pedí volver al inicio"), true);
assert.equal(looksLikeSoftFlowRestart("volvamos al menu"), true);
assert.equal(looksLikeSoftFlowRestart("Indícame el reporte de la nissan"), false);

assert.equal(looksLikeThanksOnlyAcknowledgement("gracias"), true);
assert.equal(looksLikeThanksOnlyAcknowledgement("ok"), false);
assert.equal(looksLikeThanksOnlyAcknowledgement("listo"), false);
assert.equal(looksLikeConversationAcknowledgement("ok"), true);

console.log("OK verify-ai-first-dialogue");
