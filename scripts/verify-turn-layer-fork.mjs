#!/usr/bin/env node
/**
 * Contrato turn layer: bifurcación lateral y mantenimiento durante odómetro.
 */
import assert from "node:assert/strict";
import {
  classifyOdometerFlowSideQuestion,
  buildOdometerFlowSideQuestionReply,
} from "../src/lib/pendingConfirmStance.ts";
import {
  classifyTramiteForkChoiceResponse,
  threadAwaitingTramiteForkChoice,
  looksLikeExplicitOtherTramiteIntent,
} from "../src/lib/turnLayerContract.ts";
import { classifyPivotForkChoiceResponse } from "../src/lib/tramitePivot.ts";

const threadAfterUnitAsk = [
  "Cliente: odometro",
  "Atilio: Para registrar el cambio de odómetro, necesito la patente de la unidad. ¿Cuál es?",
].join("\n");

assert.equal(classifyOdometerFlowSideQuestion("mantenimiento preventivo", threadAfterUnitAsk), "help");
const maintReply = buildOdometerFlowSideQuestionReply("help", threadAfterUnitAsk, "mantenimiento preventivo");
assert.match(maintReply, /mantenimiento.*otro trámite/i);
assert.match(maintReply, /cambiar de requerimiento/i);

const threadFork = `${threadAfterUnitAsk}\nAtilio: Te puedo ayudar. Pero antes: ¿seguimos con el *cambio de odómetro* que tenemos en curso, o preferís *cambiar de requerimiento*?`;
assert.equal(threadAwaitingTramiteForkChoice(threadFork), true);
assert.equal(classifyTramiteForkChoiceResponse("seguimos con el odometro"), "resume");
assert.equal(classifyPivotForkChoiceResponse("consultar ahora"), "switch");
assert.equal(classifyPivotForkChoiceResponse("seguir con horometro"), "resume");
assert.equal(classifyTramiteForkChoiceResponse("quiero mantenimiento preventivo"), "switch");
assert.equal(looksLikeExplicitOtherTramiteIntent("mantenimiento preventivo"), "mantenimiento");

console.log("OK verify-turn-layer-fork");
