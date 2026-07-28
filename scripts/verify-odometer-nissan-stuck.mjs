#!/usr/bin/env node
/**
 * Regresión: flujo horómetro con Nissan inexistente → patente OST / selección numérica.
 */
import {
  extractPlateFromPerfectoTomo,
  threadHasFailedUnitSearch,
  threadHasActiveOdometerFlow,
} from "../src/lib/wara.ts";
import {
  resolveNumericUnitSelection,
  resolveUnitQuery,
} from "../src/lib/waraUnitIntent.ts";
import { clientSupersedesOdometerConfirmation } from "../src/lib/waraApi.ts";

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
  { movil_id: 1, patente: "OST 223", unidad: "900-041viejo" },
  { movil_id: 2, patente: "OST 226", unidad: "x" },
  { movil_id: 3, patente: "OST 224", unidad: "y" },
  { movil_id: 4, patente: "OST 225", unidad: "z" },
];

console.log("— Nissan en el mismo mensaje que el trámite (bug WARA 2026-07-27) —");
const combinedMsg = "cambiar el horometro dela nissan";
const combined = await resolveUnitQuery({
  rawText: combinedMsg,
  threadText: "",
  units: fleet,
  preferAi: false,
  odometerContext: true,
});
assert(combined.intent === "need_clarification", "horómetro + Nissan en un mensaje → need_clarification");
assert(
  (combined.clarificationQuestion ?? "").toLowerCase().includes("nissan"),
  "mensaje menciona Nissan (no genérico vacío)",
);

console.log("\n— Nissan no encontrada en flota —");
const nissanResolved = await resolveUnitQuery({
  rawText: "Cambiar horometro a la Nissan",
  threadText: "",
  units: fleet,
  preferAi: false,
  odometerContext: true,
});
assert(nissanResolved.intent === "need_clarification", "Nissan → need_clarification");
assert(
  (nissanResolved.clarificationQuestion ?? "").toLowerCase().includes("nissan"),
  "mensaje menciona Nissan",
);

console.log("\n— Tras Nissan fallida, OST 225 resuelve sin volver a Nissan —");
const threadAfterNissan = [
  "Cambiar horometro a la Nissan",
  'No encontré ninguna unidad que coincida con «NISSAN» en la flota de El Cacique S.A.',
].join("\n");
assert(threadHasFailedUnitSearch(threadAfterNissan), "detecta búsqueda fallida");
const ost225 = await resolveUnitQuery({
  rawText: "Ost 225",
  threadText: threadAfterNissan,
  units: fleet,
  preferAi: false,
  odometerContext: true,
});
assert(ost225.intent === "consult_status" && ost225.plate === "OST225", `Ost 225 → OST225 (obtuvo ${ost225.plate})`);

console.log("\n— Selección numérica del listado OST —");
const clarifyThread = [
  "Cambiar horometro",
  "Encontré 4 unidades que empiezan con OST (OST 223, OST 226, OST 224, OST 225). Decime cuál querés consultar (patente exacta).",
].join("\n");
assert(resolveNumericUnitSelection("2", clarifyThread) === "OST226", "opción 2 → OST 226");

console.log("\n— Patente bloqueada tras 'Perfecto, tomo OST 225' —");
const lockedThread = [
  clarifyThread,
  "Perfecto, tomo OST 225. ¿Cuál es el nuevo horómetro en horas?",
].join("\n");
assert(extractPlateFromPerfectoTomo(lockedThread) === "OST225", "extractPlateFromPerfectoTomo OST225");
assert(threadHasActiveOdometerFlow(lockedThread), "flujo horómetro activo");

console.log("\n— cambiar de unidad limpia confirmación stale —");
const stale = [
  "Voy a registrar:",
  "• Patente: OST 225",
  "• Horómetro: 14 h",
  "Si está correcto, respondé CONFIRMO para registrarlo en Wara.",
].join("\n");
assert(clientSupersedesOdometerConfirmation("cambiar de unidad", stale), "cambiar de unidad supersede");

if (failed > 0) {
  console.error(`\n✗ ${failed} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ Regresión Nissan / patente / selección numérica OK");
