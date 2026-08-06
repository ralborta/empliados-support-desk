#!/usr/bin/env node
/**
 * Bug real 2026-08-06 (El Cacique):
 * "Tengo la unidad 300-097 sin reporte" → bot respondió
 * "Encontré 3 unidades (AA 251 VD, AC 093 JO, AB 042 BD)" — patentes ajenas.
 * Debe resolver M300-097 / 300-097 / 003-097, o decir no encontrado con «300-097».
 *
 * Uso: npx tsx scripts/verify-unit-name-300-097.mjs
 */
import {
  filterUnitsByUnitName,
  looksLikeUnitNameInMessage,
  resolveUnitQuery,
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

const msg = "Tengo la unidad 300-097 sin reporte";
assert(looksLikeUnitNameInMessage(msg), "detecta código interno en el mensaje");

const fleet = [
  { movil_id: 1, patente: "AA251VD", unidad: "Camion A" },
  { movil_id: 2, patente: "AC093JO", unidad: "Camion B" },
  { movil_id: 3, patente: "AB042BD", unidad: "Camion C" },
  { movil_id: 4, patente: "TARGET97", unidad: "M300-097" },
];

assert(
  filterUnitsByUnitName(fleet, "300-097").length === 1 &&
    filterUnitsByUnitName(fleet, "300-097")[0].patente === "TARGET97",
  "300-097 → M300-097",
);
assert(
  filterUnitsByUnitName(fleet, "M300-097").length === 1 &&
    filterUnitsByUnitName(fleet, "M300-097")[0].patente === "TARGET97",
  "M300-097 → misma unidad",
);

console.log("\n— resolveUnitQuery no inventa las 3 patentes ajenas —");
const q = await resolveUnitQuery({
  rawText: msg,
  threadText: "",
  units: fleet,
  preferAi: true,
  nameHint: "300-097",
  prefixHint: "AA", // hint basura de IA no debe ganar
});
assert(q.intent === "consult_status" && q.plate === "TARGET97", "resuelve TARGET97");
assert(
  !(q.clarificationQuestion || "").includes("AA 251") &&
    !(q.candidatePlates || []).includes("AA251VD"),
  "no lista AA251VD/AC093JO/AB042BD",
);

const fleetNo = fleet.filter((u) => u.patente !== "TARGET97");
const qMiss = await resolveUnitQuery({
  rawText: msg,
  threadText: "",
  units: fleetNo,
  preferAi: true,
  nameHint: "300-097",
});
assert(
  qMiss.intent === "need_clarification" &&
    (qMiss.clarificationQuestion || "").includes("300-097") &&
    (qMiss.candidatePlates || []).length === 0,
  "sin match: menciona 300-097 y sin candidatos inventados",
);

// Guión tipográfico
const msgDash = "Tengo la unidad 300\u2013097 sin reporte";
assert(looksLikeUnitNameInMessage(msgDash), "detecta guión tipográfico");
const qDash = await resolveUnitQuery({
  rawText: msgDash,
  threadText: "",
  units: fleet,
  preferAi: false,
});
assert(qDash.plate === "TARGET97", "resuelve con guión tipográfico");

if (failed > 0) {
  console.error(`\n✗ ${failed} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ verify-unit-name-300-097 OK");
