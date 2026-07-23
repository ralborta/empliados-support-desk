#!/usr/bin/env node
/**
 * Regresión, bug real producción 2026-07-23 (ticket cmrv1v4400001jy04xmjdmet1):
 *
 * 1) El cliente pidió "las coordenadas de la última ubicación de la unidad AI 154 GD"
 *    (patente explícita, con formato válido, EN el mensaje). Como también sonaba a
 *    "consulta en vivo" (coordenadas/ubicación), el bot preguntaba primero a la IA,
 *    que solo recibe una muestra recortada del catálogo (120 de 414 unidades en esta
 *    flota real) — si la patente no entraba en esa muestra, la IA no la encontraba y
 *    el bot respondía el "¿Cuál unidad?" genérico, como si el cliente no hubiese dicho
 *    nada, en vez de resolver o rechazar la patente contra el catálogo COMPLETO.
 *
 * 2) El cliente después probó "300-092" y "M300-093" (formato de NOMBRE de unidad,
 *    igual al que el propio bot sugiere de ejemplo: "M300-111") y volvió a recibir el
 *    MISMO "¿Cuál unidad?" genérico, dos veces. La causa: `looksLikePlateOnlyMessage`
 *    solo exigía "al menos un dígito", así que estos nombres (sin letras suficientes
 *    para ser una patente real) se interpretaban como intento de PATENTE suelta en vez
 *    de búsqueda por NOMBRE de unidad — y fallaban ahí con mensajes de prefijo
 *    inexistente, o el genérico, en vez de intentar `filterUnitsByNombre`.
 */
import {
  detectLoosePlate,
  detectPlate,
  looksLikePlateOnlyMessage,
} from "../src/lib/wara.ts";
import { resolveUnitQuery, buildFleetUnitNotFoundMessage } from "../src/lib/waraUnitIntent.ts";

let failed = 0;
function assert(cond, label) {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${label}`);
  }
}

console.log("— Nombres de unidad tipo \"300-092\"/\"M300-093\" NO se confunden con patente suelta —");

for (const t of ["300-092", "M300-093", "300092"]) {
  assert(!looksLikePlateOnlyMessage(t), `"${t}" no es una patente suelta (no tiene letras suficientes)`);
  assert(!detectLoosePlate(t), `detectLoosePlate("${t}") === null (no es una patente)`);
  assert(!detectPlate(t), `detectPlate("${t}") === null (no matchea el regex de patente)`);
}

// Sanity: las patentes sueltas reales SIGUEN detectándose igual que antes.
for (const t of ["Lwk7902", "NKL961", "AD427MC"]) {
  assert(!!detectLoosePlate(t), `detectLoosePlate("${t}") sigue detectando patentes reales sueltas`);
}

console.log("— Patente explícita y válida en el mensaje se resuelve contra el catálogo COMPLETO antes de la IA —");

// Flota grande (>120 unidades) simulando el caso real (414 unidades): la unidad target
// está deliberadamente MÁS ALLÁ del recorte que se le daría a la IA (limit 120), para
// probar que ya no depende de esa muestra parcial.
const bigFleet = Array.from({ length: 300 }, (_, i) => ({
  movil_id: i + 1,
  patente: `ZZ${String(100 + i).padStart(3, "0")}XX`,
  unidad: `RELLENO ${i}`,
}));
bigFleet.push({ movil_id: 9001, patente: "AI154GD", unidad: "M300-200" });

const liveConsult = await resolveUnitQuery({
  rawText: "Me podrías dar las coordenadas de la última ubicación de la unidad AI 154 GD",
  threadText: "",
  units: bigFleet,
  preferAi: false, // sin OPENAI_API_KEY en test, pero el fix debe ser correcto también preferAi=true
});
assert(
  liveConsult.intent === "consult_status" && liveConsult.plate === "AI154GD",
  "patente explícita presente en una flota grande se resuelve directo, sin depender de un recorte",
);

const liveConsultMissing = await resolveUnitQuery({
  rawText: "Me podrías dar las coordenadas de la última ubicación de la unidad ZZ999ZZ",
  threadText: "",
  units: bigFleet,
  preferAi: false,
});
assert(
  liveConsultMissing.intent === "need_clarification" &&
    (liveConsultMissing.clarificationQuestion ?? "")
      .toLowerCase()
      .replace(/\s+/g, "")
      .includes("zz999zz"),
  "patente explícita AUSENTE de una flota grande se rechaza mencionando la patente buscada (no el genérico)",
);

console.log("— Sanity: queja genérica sin dato sigue pidiendo el identificador de forma neutra —");

const generic = await resolveUnitQuery({
  rawText: "tengo problemas con una unidad",
  threadText: "",
  units: bigFleet,
  preferAi: false,
});
assert(
  (generic.clarificationQuestion ?? "") === buildFleetUnitNotFoundMessage({}),
  "queja sin ningún dato sigue usando el mensaje neutro (no dice 'no encontré')",
);

if (failed > 0) {
  console.error(`\n✗ ${failed} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ Verificación de nombre-de-unidad vs. patente OK");
