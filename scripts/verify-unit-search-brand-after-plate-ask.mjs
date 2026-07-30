#!/usr/bin/env node
/**
 * Regresión bug real 2026-07-30: consulta GPS "última posición de la AG" → bot pide patente
 * → cliente "la nissan" debe buscar en flota y listar similares, no pedir patente completa otra vez.
 *
 * Uso: npx tsx scripts/verify-unit-search-brand-after-plate-ask.mjs
 */
import { hasPendingUnitConsultPlateRequest } from "../src/lib/wara.ts";
import { looksLikeGpsOrUnitStatusQuestion } from "../src/lib/waraApi.ts";
import {
  looksLikeFleetUnitSearchInput,
  resolveUnitQuery,
  shouldRouteTurnToUnidadesExecutor,
} from "../src/lib/waraUnitIntent.ts";

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

console.log("— Primera pregunta con prefijo AG + posición —");
const firstAsk = "indicame la ultima posicion de la AG";
assert(looksLikeGpsOrUnitStatusQuestion(firstAsk), "detecta consulta GPS/posición");
assert(looksLikeFleetUnitSearchInput(firstAsk), "detecta prefijo AG como búsqueda");
assert(
  shouldRouteTurnToUnidadesExecutor({ selectionText: firstAsk, threadText: "" }),
  "bypass a unidades en primera pregunta (no agente)",
);

console.log("\n— Tras pedido de patente (texto agente) —");
const agentThread = [
  "Cliente: indicame la ultima posicion de la AG",
  "Atilio: Para poder ayudarte con la última posición de la AG, necesito que me indiques la patente de la unidad que querés consultar. ¿Cuál es?",
].join("\n");
assert(
  hasPendingUnitConsultPlateRequest(agentThread),
  "hasPendingUnitConsultPlateRequest reconoce pedido agente",
);

console.log("\n— Respuesta 'la nissan' → similares en flota —");
const brandReply = "la nissan";
assert(looksLikeFleetUnitSearchInput(brandReply), "la nissan es búsqueda de flota");
assert(
  shouldRouteTurnToUnidadesExecutor({ selectionText: brandReply, threadText: agentThread }),
  "shouldRouteTurnToUnidadesExecutor('la nissan') tras pedido de patente",
);

const resolved = await resolveUnitQuery({
  rawText: brandReply,
  threadText: agentThread,
  units: fleet,
  preferAi: true,
});
assert(
  resolved.intent === "need_clarification" && resolved.candidatePlates.length === 2,
  `lista 2 Nissan (obtuvo plates=${resolved.candidatePlates.length})`,
);
assert(
  /AG\s*562|AG\s*701|562|701/.test(resolved.clarificationQuestion ?? ""),
  "el mensaje incluye patentes similares, no pide patente completa a ciegas",
);

console.log("\n— Prefijo AG devuelve unidades que empiezan con AG —");
const prefixResolved = await resolveUnitQuery({
  rawText: firstAsk,
  threadText: "",
  units: fleet,
  preferAi: true,
});
assert(
  prefixResolved.intent === "need_clarification" && prefixResolved.candidatePlates.length === 2,
  `prefijo AG lista ${prefixResolved.candidatePlates.length} unidades`,
);

console.log("\n— Pregunta directa con marca en el mismo mensaje (captura 9:41) —");
const directBrand = "Me pasas la posición de la Nissan?";
assert(looksLikeFleetUnitSearchInput(directBrand), "detecta Nissan en pregunta GPS");
assert(
  shouldRouteTurnToUnidadesExecutor({ selectionText: directBrand, threadText: "" }),
  "bypass unidades sin pedir patente primero",
);
const directResolved = await resolveUnitQuery({
  rawText: directBrand,
  threadText: "",
  units: fleet,
  preferAi: true,
});
assert(
  directResolved.intent === "need_clarification" && directResolved.candidatePlates.length === 2,
  `lista Nissan similares sin pedir patente (plates=${directResolved.candidatePlates.length})`,
);
assert(
  /AG\s*562|AG\s*701/.test(directResolved.clarificationQuestion ?? ""),
  "incluye patentes en la respuesta",
);

if (failed > 0) {
  console.error(`\n✗ ${failed} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ Búsqueda por marca/prefijo tras consulta GPS OK");
