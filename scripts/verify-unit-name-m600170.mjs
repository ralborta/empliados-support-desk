#!/usr/bin/env node
/**
 * Regresión bug real 2026-07-28 (El Cacique / M600-170):
 * - Nombre M600-170 debe resolver contra campo unidad exacto, no substring "600-170".
 * - IA no debe pisar con OOC237 cuando M600-170 no está en unidad.
 * - Tras aclaración (AI 329 TL, OOC 237): "termina con TL" / "comienza con AI" resuelven.
 * - Mensaje con matrícula explícita gana sobre nombre interno.
 *
 * Uso: npx tsx scripts/verify-unit-name-m600170.mjs
 */
import { extractPlateSuffixFromMessage } from "../src/lib/wara.ts";
import { resolveUnitQuery, filterUnitsByUnitName } from "../src/lib/waraUnitIntent.ts";

const fleet = [
  { movil_id: 1, patente: "AI329TL", unidad: "M600-170" },
  { movil_id: 2, patente: "OOC237", unidad: "Tanda 600-170 backup" },
  { movil_id: 3, patente: "AD626UH", unidad: "M300-131" },
];

const threadClarify =
  "Bot: Encontré 2 unidades (AI 329 TL, OOC 237). Decime la patente exacta.";

let failed = 0;
function assert(cond, label) {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}

console.log("— filterUnitsByUnitName: exacto, no substring 600-170 en otro nombre —");
const looseHits = filterUnitsByUnitName(fleet, "M600-170");
assert(looseHits.length === 1 && looseHits[0].patente === "AI329TL", "solo M600-170 exacto");

console.log("\n— Consulta por M600-170 (reglas, sin depender de IA) —");
const q1 = await resolveUnitQuery({
  rawText: "Quiero consultar por el reporte de la unidad M600-170",
  threadText: "",
  units: fleet,
  preferAi: true,
});
assert(q1.intent === "consult_status" && q1.plate === "AI329TL", "M600-170 → AI329TL");
assert(q1.source === "rules", "resuelto por reglas, no IA");

console.log("\n— Sin M600-170 en flota: mensaje claro de no encontrado —");
const fleetNoName = [
  { movil_id: 2, patente: "OOC237", unidad: "Tanda 600-170 backup" },
  { movil_id: 3, patente: "AD626UH", unidad: "M300-131" },
];
const q2 = await resolveUnitQuery({
  rawText: "quiero saber el estado de reporte de la unidad M600-170",
  threadText: "",
  units: fleetNoName,
  preferAi: true,
});
assert(
  q2.intent === "need_clarification" &&
    (q2.clarificationQuestion ?? "").includes("M600-170") &&
    q2.plate !== "OOC237",
  "no encontrado / no alucina OOC237",
);

console.log("\n— Matrícula explícita gana sobre interno —");
const q3 = await resolveUnitQuery({
  rawText: "el interno M600-170 tiene como matricula AI 329 TL",
  threadText: "",
  units: fleetNoName.concat({ movil_id: 1, patente: "AI329TL", unidad: "M600-170" }),
  preferAi: false,
});
assert(q3.plate === "AI329TL", "AI 329 TL explícita gana");

console.log("\n— Aclaración tras listado de candidatos —");
assert(extractPlateSuffixFromMessage("la que termina con TL") === "TL", "suffix TL detectado");
const q4 = await resolveUnitQuery({
  rawText: "la que termina con TL",
  threadText: threadClarify,
  units: fleet,
  preferAi: true,
});
assert(q4.intent === "consult_status" && q4.plate === "AI329TL", "termina con TL → AI329TL");

const q5 = await resolveUnitQuery({
  rawText: "Es la que comienza con AI",
  threadText: threadClarify,
  units: fleet,
  preferAi: true,
});
assert(q5.intent === "consult_status" && q5.plate === "AI329TL", "comienza con AI → AI329TL");

if (failed > 0) {
  console.error(`\n✗ ${failed} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ Regresión M600-170 OK");
