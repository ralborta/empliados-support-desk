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

// Regresión producción 2026-07-28 (misma tanda, segunda vuelta): typo "empiza" (sin la
// segunda "e" de "empieza") en un pedido de ESTADO/GPS (no odómetro) también debía
// detectar el prefijo, para no perder el listado de candidatos reales y caer en el
// genérico "Encontré varias unidades posibles" de la IA.
assert(
  extractPlatePrefixFromMessage("quiero el estado de la unidad q empiza con OST") === "OST",
  "typo 'empiza' (sin la segunda e) se detecta igual",
);
assert(extractPlatePrefixFromMessage("la que comenza con MYQ") === "MYQ", "typo 'comenza' se detecta igual");
assert(extractPlatePrefixFromMessage("la que cominza con RMX") === "RMX", "typo 'cominza' se detecta igual");

// Bug real 2026-08-06: typos fuertes del verbo ("coiemza", "cvomienza") + prefijo.
// Solución general (Levenshtein / forma blanda), no whitelist de frases.
assert(extractPlatePrefixFromMessage("coiemza ad") === "AD", "typo fuerte 'coiemza ad' → AD");
assert(extractPlatePrefixFromMessage("cvomienza con ad") === "AD", "typo fuerte 'cvomienza con ad' → AD");
assert(looksLikeFleetUnitSearchInput("coiemza ad"), "'coiemza ad' es búsqueda de flota");
assert(looksLikeFleetUnitSearchInput("cvomienza con ad"), "'cvomienza con ad' es búsqueda de flota");
assert(looksLikeFleetUnitSearchInput("la q comienza con ad"), "'la q comienza con ad' sigue OK");

// Prefijo usable → siempre executor unidades (aunque no haya marcador de “pedí patente”).
assert(
  shouldRouteTurnToUnidadesExecutor({ selectionText: "coiemza ad", threadText: "" }),
  "coiemza ad (sin hilo) → shouldRouteTurnToUnidadesExecutor",
);
assert(
  shouldRouteTurnToUnidadesExecutor({ selectionText: "cvomienza con ad", threadText: "" }),
  "cvomienza con ad → shouldRouteTurnToUnidadesExecutor",
);

// Prefijo YA razonado (simula unit_ref de IA) aunque el texto crudo no diga nada usable.
{
  const fleetAi = [
    { movil_id: 1, patente: "AD427MC", unidad: "1" },
    { movil_id: 2, patente: "AD626UJ", unidad: "2" },
    { movil_id: 3, patente: "XX111AA", unidad: "3" },
  ];
  const uqAi = await resolveUnitQuery({
    rawText: "xyzqwerty tipografico sin sentido",
    threadText: "",
    units: fleetAi,
    preferAi: false,
    prefixHint: "AD",
  });
  assert(
    uqAi.intent === "need_clarification" && (uqAi.candidatePlates ?? []).length === 2,
    `prefixHint override IA → lista AD (intent=${uqAi.intent}, n=${(uqAi.candidatePlates ?? []).length})`,
  );
}

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

// Mismo caso pero en el flujo de ESTADO/GPS (unidades/route.ts), que llama a
// resolveUnitQuery sin odometerContext/certificateContext — antes del fix, el typo
// "empiza" hacía que se saltee la ruta de reglas y la IA respondiera con el genérico
// "Encontré varias unidades posibles" sin listar las patentes reales.
const uqEstado = await resolveUnitQuery({
  rawText: "quiero el estado de la unidad q empiza con OST",
  threadText: "",
  units: fleet,
  preferAi: true,
});
assert(
  uqEstado.intent === "need_clarification",
  `estado/GPS con typo 'empiza': pide aclaración (intent=${uqEstado.intent})`,
);
assert(
  (uqEstado.candidatePlates ?? []).length === 4,
  `estado/GPS con typo 'empiza': lista las 4 patentes (obtuvo ${(uqEstado.candidatePlates ?? []).length})`,
);
assert(
  /OST\s*22[3-6]/.test(uqEstado.clarificationQuestion ?? ""),
  `estado/GPS con typo 'empiza': el mensaje menciona las patentes reales (${uqEstado.clarificationQuestion})`,
);

if (failed > 0) {
  console.error(`\n✗ ${failed} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ Prefijo 'comienza/empieza X' (con typos, sin 'con', en odómetro y estado/GPS) se detecta y lista candidatos");
