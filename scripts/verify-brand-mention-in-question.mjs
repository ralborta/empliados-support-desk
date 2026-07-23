#!/usr/bin/env node
/**
 * Regresión del bug real (producción, 2026-07-23): el cliente pregunta directamente
 * "Ok quiero saber si Nissan está marcando posición?" (la marca YA está en el primer
 * mensaje) y el bot igual responde pidiendo la patente o la marca/nombre, como si no
 * hubiera dicho nada. Recién al repetir "Nissan" solo, resuelve.
 *
 * Causa raíz: looksLikeVehicleBrandOrUnitSearch (src/lib/waraApi.ts) tenía dos topes
 * pensados solo para respuestas CORTAS a una aclaración ya hecha por el bot ("Nissan",
 * "es la Saveiro"): máximo 48 caracteres normalizados y máximo 6 tokens. Una pregunta
 * natural en primera persona con la marca adentro ("Ok quiero saber si Nissan está
 * marcando posición?" = 51 caracteres, 8 tokens) superaba ambos topes y la función
 * devolvía false — lo que hacía que looksLikeFleetUnitSearchInput también diera false,
 * y el gate temprano de src/app/api/wara/unidades/route.ts (antes de llamar a
 * resolveUnitQuery) terminaba pidiendo la unidad desde cero, ignorando la marca ya
 * mencionada.
 *
 * Uso: npx tsx scripts/verify-brand-mention-in-question.mjs
 */
import { looksLikeVehicleBrandOrUnitSearch } from "../src/lib/waraApi.ts";
import { looksLikeFleetUnitSearchInput, resolveUnitQuery } from "../src/lib/waraUnitIntent.ts";

let failed = 0;
function assert(cond, label) {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}

console.log("— La marca mencionada en una pregunta natural (no solo en una respuesta corta) se detecta —");
const naturalQuestions = [
  "Ok quiero saber si Nissan está marcando posición?",
  "quiero saber si la Nissan esta marcando posicion",
  "hola, me podes decir si la Nissan esta reportando bien?",
  "necesito saber el estado de la Toyota por favor",
];
for (const text of naturalQuestions) {
  assert(looksLikeVehicleBrandOrUnitSearch(text), `looksLikeVehicleBrandOrUnitSearch("${text}") === true`);
  assert(looksLikeFleetUnitSearchInput(text), `looksLikeFleetUnitSearchInput("${text}") === true`);
}

console.log("\n— Respuestas cortas (el caso que ya funcionaba) siguen funcionando —");
assert(looksLikeVehicleBrandOrUnitSearch("Nissan"), 'looksLikeVehicleBrandOrUnitSearch("Nissan") === true');
assert(looksLikeVehicleBrandOrUnitSearch("es la Saveiro"), 'looksLikeVehicleBrandOrUnitSearch("es la Saveiro") === true');

console.log("\n— Sanity: mención de la empresa/plataforma (no de una marca real) sigue excluida —");
assert(!looksLikeVehicleBrandOrUnitSearch("quiero cambiar de empresa"), 'mención de "empresa" sigue devolviendo false');
assert(!looksLikeVehicleBrandOrUnitSearch("hola buenas, como estas"), "saludo sin marca sigue devolviendo false");

console.log("\n— La resolución completa (resolveUnitQuery) ya encuentra la unidad en la PRIMERA pregunta, sin pedir aclaración —");
const fleet = [{ movil_id: 1, patente: "AG 562 SP", unidad: "NISSAN 2404" }];
const resolved = await resolveUnitQuery({
  rawText: "Ok quiero saber si Nissan está marcando posición?",
  threadText: "",
  units: fleet,
  preferAi: true,
});
assert(
  resolved.intent === "consult_status" && resolved.plate === "AG562SP",
  `resuelve AG562SP en el primer mensaje (obtuvo intent=${resolved.intent} plate=${resolved.plate ?? "-"})`,
);

if (failed > 0) {
  console.error(`\n✗ ${failed} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ Verificación de detección de marca en pregunta natural OK");
