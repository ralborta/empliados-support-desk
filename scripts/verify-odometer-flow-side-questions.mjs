#!/usr/bin/env node
/**
 * Consultas laterales durante odómetro activo: explicar en contexto y ofrecer
 * retomar trámite o cambiar de requerimiento (no aclaraciones genéricas).
 */
import assert from "node:assert/strict";
import { classifyTurnExecutor } from "../src/lib/whatsappTurnRouter.ts";
import {
  classifyOdometerFlowSideQuestion,
  buildOdometerFlowSideInfoReply,
  buildOdometerFlowSideHelpReply,
} from "../src/lib/pendingConfirmStance.ts";
import { shouldRouteTurnToOdometerExecutor } from "../src/lib/waraUnitIntent.ts";

const threadAfterUnitAsk = [
  "Cliente: odometro",
  "Atilio: Para registrar el cambio de odómetro, necesito la patente de la unidad. ¿Cuál es?",
].join("\n");

const threadWith900097 = `${threadAfterUnitAsk}\nCliente: 900097`;

assert.equal(classifyOdometerFlowSideQuestion("900097", threadAfterUnitAsk), null);
assert.equal(
  shouldRouteTurnToOdometerExecutor({ selectionText: "900097", threadText: threadAfterUnitAsk }),
  true,
);
assert.equal(classifyTurnExecutor("900097", threadWith900097), "odometro");

const threadMidFlow =
  threadWith900097 + "\nAtilio: Tomé la unidad (900097). Pasame el km.";

assert.equal(classifyOdometerFlowSideQuestion("Como funciona?", threadAfterUnitAsk), "info");
const infoReply = buildOdometerFlowSideInfoReply(threadAfterUnitAsk, "Como funciona?");
assert.match(infoReply, /Te referís al \*odómetro\*/i);
assert.match(infoReply, /seguimos con el cambio/i);

assert.equal(classifyOdometerFlowSideQuestion("Como hago?", threadAfterUnitAsk), "help");
const helpReply = buildOdometerFlowSideHelpReply(threadAfterUnitAsk);
assert.match(helpReply, /seguimos con el \*cambio de odómetro\*/i);
assert.match(helpReply, /cambiar de requerimiento/i);

assert.equal(classifyOdometerFlowSideQuestion("Cuanto tarda?", threadAfterUnitAsk), "help");
assert.equal(classifyOdometerFlowSideQuestion("Puedo hacerlo mañana?", threadAfterUnitAsk), "help");
assert.equal(classifyOdometerFlowSideQuestion("Quiero un certificado", threadAfterUnitAsk), "help");

assert.equal(
  classifyOdometerFlowSideQuestion("125000", threadMidFlow),
  null,
  "km operativo no es consulta lateral",
);
assert.equal(
  shouldRouteTurnToOdometerExecutor({ selectionText: "125000", threadText: threadMidFlow }),
  true,
);

console.log("OK verify-odometer-flow-side-questions");
