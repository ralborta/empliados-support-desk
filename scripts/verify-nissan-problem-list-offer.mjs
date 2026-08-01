#!/usr/bin/env node
/**
 * Regresión bug real 2026-07-31: "no me anda la nissan" → agente pide patente;
 * ofrece listado → "dale porfa" busca "dale porfa" en flota en vez de listar.
 */
import { hasPendingUnitConsultPlateRequest } from "../src/lib/wara.ts";
import {
  looksLikeFleetUnitSearchInput,
  looksLikeFleetListContinuation,
  threadBotOfferedUnitList,
  resolveUnitQuery,
  shouldRouteTurnToUnidadesExecutor,
  shouldRouteTurnToFleetListExecutor,
} from "../src/lib/waraUnitIntent.ts";
import { looksLikeVagueUnitProblemReport } from "../src/lib/waraApi.ts";

let failed = 0;
function assert(cond, label) {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}

const fleet = [
  { movil_id: 1, patente: "AG 562 SP", unidad: "NISSAN 2404" },
  { movil_id: 2, patente: "AG 701 XK", unidad: "NISSAN FRONTIER" },
  { movil_id: 3, patente: "OST 223", unidad: "M300-111" },
];

console.log("— Problema vago con marca Nissan → buscar en flota —");
const problemMsg = "no me anda la nissan";
assert(looksLikeVagueUnitProblemReport(problemMsg), "problema vago con unidad");
assert(looksLikeFleetUnitSearchInput(problemMsg), "Nissan es búsqueda en flota");
assert(
  shouldRouteTurnToUnidadesExecutor({ selectionText: problemMsg, threadText: "" }),
  "bypass a unidades (no agente pidiendo patente)",
);

const nissanResolved = await resolveUnitQuery({
  rawText: problemMsg,
  threadText: "",
  units: fleet,
  preferAi: true,
});
assert(
  nissanResolved.intent === "need_clarification" && nissanResolved.candidatePlates.length === 2,
  `lista similares Nissan (plates=${nissanResolved.candidatePlates.length})`,
);

console.log("\n— Tras oferta de listado del agente —");
const agentThread = [
  "Cliente: no me anda la nissan",
  "Atilio: Entiendo que tenés un problema con la Nissan. Para poder ayudarte mejor, ¿me podrías pasar la patente de la unidad?",
  "Cliente: no la recuerdo",
  "Atilio: Entiendo, Emmanuel. No hay problema. ¿Te gustaría que te pase el listado de tus unidades para que puedas identificar la Nissan?",
].join("\n");
assert(threadBotOfferedUnitList(agentThread), "detecta oferta de listado en el hilo");
assert(
  hasPendingUnitConsultPlateRequest(agentThread),
  "pedido previo de patente en el hilo",
);

console.log("\n— 'dale porfa' confirma listado, no busca en flota —");
const confirmList = "dale porfa";
assert(
  looksLikeFleetListContinuation(confirmList, agentThread),
  "dale porfa es continuación de listado",
);
assert(
  shouldRouteTurnToFleetListExecutor({ selectionText: confirmList, threadText: agentThread }),
  "enruta a listado de flota",
);
assert(
  !shouldRouteTurnToUnidadesExecutor({ selectionText: confirmList, threadText: agentThread }),
  "no trata dale porfa como búsqueda de unidad",
);

if (failed > 0) {
  console.error(`\n✗ ${failed} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ Nissan + confirmación de listado OK");
