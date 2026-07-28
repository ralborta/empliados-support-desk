#!/usr/bin/env node
/**
 * Regresión producción 2026-07-28: "cambiar el odometro de la q comienza OST" (SIN la
 * palabra "con") no era reconocido como prefijo de patente por extractPlatePrefixFromMessage
 * (el patrón exigía "empieza/comienza CON X" a rajatabla). Al no detectarse el prefijo, el
 * endpoint de odómetro asumía que no había ninguna referencia a unidad en el mensaje y dejaba
 * pasar sin validar contra la flota lo que el extractor de IA/regex hubiera propuesto como
 * "patente" — terminando en "Perfecto, tomo OST. ¿Cuál es el nuevo odómetro en km?" en vez de
 * listar las 4 unidades reales que empiezan con OST (OST 223, OST 224, OST 225, OST 226) y
 * preguntar cuál.
 */
import { extractPlatePrefixFromMessage } from "../src/lib/wara.ts";
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

const msg = "cambiar el odometro de la q comienza OST";

assert(extractPlatePrefixFromMessage(msg) === "OST", `prefijo OST detectado sin la palabra 'con' (${extractPlatePrefixFromMessage(msg)})`);
assert(looksLikeFleetUnitSearchInput(msg), "mensaje se reconoce como búsqueda de unidad en flota");

// Variantes equivalentes que también deben detectarse.
assert(extractPlatePrefixFromMessage("la que empieza OST") === "OST", "variante 'la que empieza OST' (sin con)");
assert(extractPlatePrefixFromMessage("la que comienza con OST") === "OST", "variante con 'con' sigue funcionando");
assert(extractPlatePrefixFromMessage("empieza OST") === "OST", "variante 'empieza OST' (sin con)");

// Falsos positivos que NO deben dispararse tras aflojar la palabra "con".
assert(extractPlatePrefixFromMessage("no se cuando comienza el mantenimiento") === null, "'comienza el' no matchea (stopword 'el')");
assert(extractPlatePrefixFromMessage("la reunion comienza a las 10") === null, "'comienza a' no matchea (stopword 'a')");

const fleet = [
  { movil_id: 1, patente: "OST223", unidad: "900-041viejo" },
  { movil_id: 2, patente: "OST224", unidad: "900-042" },
  { movil_id: 3, patente: "OST225", unidad: "900-043" },
  { movil_id: 4, patente: "OST226", unidad: "900-044" },
];

const uq = await resolveUnitQuery({
  rawText: msg,
  threadText: "",
  units: fleet,
  preferAi: false,
});

assert(
  uq.intent === "need_clarification",
  `varias unidades con prefijo OST piden aclaración en vez de resolver una sola (intent=${uq.intent})`,
);
assert(
  (uq.candidatePlates ?? []).length === 4,
  `lista las 4 unidades candidatas (obtuvo ${(uq.candidatePlates ?? []).length})`,
);

if (failed > 0) {
  console.error(`\n✗ ${failed} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ Prefijo 'comienza/empieza X' sin la palabra 'con' se detecta y pide aclaración con varias unidades");
