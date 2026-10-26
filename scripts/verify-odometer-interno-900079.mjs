#!/usr/bin/env node
/**
 * Bug prod 2026-08-22: Odómetro → agente pide patente+km → "900079" →
 * utterance IA aclara "¿es parte de la patente?" en vez de buscar interno en flota.
 */
import assert from "node:assert/strict";
import { classifyTurnExecutor } from "../src/lib/whatsappTurnRouter.ts";
import {
  threadHasActiveOdometerFlow,
  threadAwaitingOdometerPlate,
} from "../src/lib/wara.ts";
import {
  extractMovilIdFromUnitMessage,
  shouldRouteTurnToOdometerExecutor,
} from "../src/lib/waraUnitIntent.ts";
import { shouldInterpretAmbiguousUtterance } from "../src/lib/utteranceUnderstanding.ts";
import { looksLikePendingConfirmHelpOrConfusion } from "../src/lib/wara.ts";

const agentOdometerThread = [
  "Cliente: Hola",
  "Atilio: 👋 Hola 🏢 Seguimos con El Cacique.",
  "Cliente: Odometro",
  "Atilio: Para poder registrar el cambio de odómetro, necesito algunos datos:\n1. ¿Cuál es la patente de la unidad?\n2. ¿Qué valor nuevo de odómetro querés registrar en kilómetros?",
].join("\n");

assert.equal(extractMovilIdFromUnitMessage("900079"), 900079);
assert.equal(extractMovilIdFromUnitMessage("interno 900079"), 900079);
assert.equal(extractMovilIdFromUnitMessage("numero de interno 900079"), 900079);

assert.equal(threadAwaitingOdometerPlate(agentOdometerThread), true);
assert.equal(threadHasActiveOdometerFlow(agentOdometerThread), true);

assert.equal(
  shouldInterpretAmbiguousUtterance("900079", agentOdometerThread),
  false,
  "no utterance layer con odómetro activo",
);

assert.equal(
  shouldRouteTurnToOdometerExecutor({
    selectionText: "900079",
    threadText: agentOdometerThread,
  }),
  true,
);

assert.equal(
  classifyTurnExecutor("900079", `${agentOdometerThread}\nCliente: 900079`),
  "odometro",
);

const afterClarify = `${agentOdometerThread}\nCliente: 900079\nAtilio: ¿Es parte de la patente?`;
assert.equal(looksLikePendingConfirmHelpOrConfusion("Q hago?"), true);
assert.equal(
  classifyTurnExecutor("Q hago?", afterClarify),
  "odometro",
  "qué hago en trámite odómetro → odometro (ayuda), no info_guides",
);

console.log("OK verify-odometer-interno-900079");
