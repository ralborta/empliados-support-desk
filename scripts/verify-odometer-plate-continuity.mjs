#!/usr/bin/env node
/**
 * Regresión del bug real (producción, 2026-07-23): al actualizar odómetro por marca
 * ("cambiar el odometro de la nissan" → bot resuelve y confirma "tomo AG 562 SP" →
 * cliente manda el km nuevo), el registro final se intentaba contra "OST 223", una
 * patente mencionada ANTES en la misma conversación por otro trámite, en vez de la
 * recién confirmada AG 562 SP.
 *
 * Causa raíz: src/app/api/wara/odometro-horometro/route.ts resolvía la patente del
 * hilo con `detectPlate(threadText)`, que devuelve la PRIMERA patente que aparece en
 * todo el texto (orden cronológico), no la última mencionada. Se reemplazó por
 * `extractLastPlateFromThread`, que recorre el hilo de más reciente a más antiguo.
 *
 * Uso: npx tsx scripts/verify-odometer-plate-continuity.mjs
 */
import { detectPlate, extractLastPlateFromThread } from "../src/lib/wara.ts";

let failed = 0;
function assert(cond, label) {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${label}`);
  }
}

// Hilo real (resumido): el cliente ya había mencionado OST 223 antes en el mismo
// ticket por otro trámite, y ahora pide cambiar el odómetro de "la nissan".
const thread = [
  "Hola, tengo un problema con la OST 223, no reporta hace rato",
  "La unidad OST 223 (CAMION 1) presenta ignición apagada. Generé el caso N° 2107260.",
  "Hola Emii, seguimos por acá. ¿Qué necesitás?",
  "Necesito cambiar el odometro de la nissan",
  "Para registrar el cambio de odómetro necesito la patente de la unidad. ¿Cuál es? (podés usar guiones, ej. AB 006 EX, o decime la marca/nombre)",
  "Nissan",
  "Perfecto, tomo AG 562 SP. ¿Cuál es el nuevo odómetro en km?",
].join("\n");

console.log("— Bug real: detectPlate(threadText) toma la PRIMERA patente del hilo —");
assert(
  detectPlate(thread) === "OST223",
  "detectPlate confirma el bug: devuelve OST223 (la primera, no la vigente) — documenta el comportamiento viejo",
);

console.log("— Fix: extractLastPlateFromThread toma la ÚLTIMA patente vigente —");
assert(
  extractLastPlateFromThread(thread) === "AG562SP",
  "extractLastPlateFromThread resuelve AG562SP (la recién confirmada), no OST223",
);

// Caso simétrico: si la mención más reciente fuera OST 223 (p. ej. el cliente vuelve
// a ese tema después), debe seguir tomando esa como vigente — no hardcodea "la última
// real", sigue el orden del hilo.
const threadReversed = [
  "Necesito cambiar el odometro de la nissan",
  "Perfecto, tomo AG 562 SP. ¿Cuál es el nuevo odómetro en km?",
  "Uy no, mejor la OST 223",
  "Perfecto, tomo OST 223. ¿Cuál es el nuevo odómetro en km?",
].join("\n");
assert(
  extractLastPlateFromThread(threadReversed) === "OST223",
  "extractLastPlateFromThread sigue el orden real del hilo (no hardcodea una patente fija)",
);

if (failed > 0) {
  console.error(`\n✗ ${failed} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ Verificación de continuidad de patente en flujo de odómetro OK");
