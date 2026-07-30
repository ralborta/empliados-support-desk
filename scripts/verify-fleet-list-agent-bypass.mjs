#!/usr/bin/env node
/**
 * Regresión producción 2026-07-30: pedido de listado de flota NO debe pedir patente.
 * El agente alucinaba "indicame la patente para pasarte la lista" en loop.
 *
 * Uso: npx tsx scripts/verify-fleet-list-agent-bypass.mjs
 */
import assert from "node:assert";
import {
  looksLikeUnitListRequest,
  looksLikeFleetListContinuation,
  shouldRouteTurnToFleetListExecutor,
  threadHasRecentFleetListIntent,
} from "../src/lib/waraUnitIntent.ts";
import { classifyTurnExecutor } from "../src/lib/whatsappTurnRouter.ts";

let passed = 0;
function check(label, cond) {
  assert.ok(cond, label);
  passed++;
  console.log(`  ✓ ${label}`);
}

console.log("— Pedidos explícitos de listado —");
for (const msg of [
  "Pásame la lista de flota",
  "Necesito la lista de las unidades",
  "listado de mis unidades",
  "pasame el listado de unidades",
]) {
  check(`looksLikeUnitListRequest: "${msg.slice(0, 35)}"`, looksLikeUnitListRequest(msg) === true);
}

const agentLoopThread = [
  "Cliente: Pásame la lista de flota",
  "Atilio: Para poder pasarte la lista de flota, necesito que me indiques la patente de alguna unidad o la marca/nombre de la misma. ¿Cuál es la unidad que quieres consultar?",
  "Cliente: Necesito la lista de las unidades",
  "Atilio: Para poder ayudarte con la lista de unidades, necesito que me indiques la patente de alguna unidad o simplemente que digas 'listado de mis unidades' si quieres ver todas. ¿Cuál prefieres?",
  "Cliente: Todo",
  "Atilio: Para ver todas las unidades de tu flota, por favor indícame la patente de alguna unidad o simplemente confirma que quieres el 'listado de mis unidades'. ¿Cuál prefieres?",
  "Cliente: No tengo idea",
].join("\n");

console.log("\n— Hilo con loop del agente (debe reconocer intención de listado) —");
check("threadHasRecentFleetListIntent", threadHasRecentFleetListIntent(agentLoopThread) === true);

console.log("\n— Continuaciones → bypass a unidades (listado real) —");
for (const msg of ["Todo", "No tengo idea", "Necesito la lista de las unidades", "La patente"]) {
  check(
    `shouldRouteTurnToFleetListExecutor("${msg}")`,
    shouldRouteTurnToFleetListExecutor({ selectionText: msg, threadText: agentLoopThread }) === true,
  );
}

console.log("\n— Router clásico sigue yendo a unidades —");
check(
  'classifyTurnExecutor("Pásame la lista de flota") === "unidades"',
  classifyTurnExecutor("Pásame la lista de flota", "") === "unidades",
);

console.log("\n— Patente concreta NO es continuación de listado —");
check(
  'looksLikeFleetListContinuation("OST 223", agentLoopThread) === false',
  looksLikeFleetListContinuation("OST 223", agentLoopThread) === false,
);

console.log(`\n✅ ${passed} checks pasaron.`);
