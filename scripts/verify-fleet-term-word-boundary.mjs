#!/usr/bin/env node
/**
 * Regresión de fondo (producción, 2026-07-28): la búsqueda de unidades por texto
 * (`filterUnitsBySearchTerms`, usada por certificados/odómetro/unidades/mantenimiento)
 * pegaba patente+unidad en un único string sin espacios ("Mascotas GP30" →
 * "mascotasgp30") y matcheaba por SUBSTRING en cualquier posición. Relleno
 * conversacional corto y común como "mas" (de "más", sin tilde tras normalizar)
 * termina siendo substring literal de "Mascotas" — el bot resolvía esa unidad al
 * azar (y hasta generaba un caso/ticket) para mensajes como "mas lista"/"mas
 * unidades" que no tenían NADA que ver con ella.
 *
 * Esto no era un caso aislado de una frase puntual: es una clase entera de bugs
 * (cualquier palabra común que por casualidad sea substring de un nombre de unidad
 * real de la flota). El fix exige coincidencia de PALABRA COMPLETA (o prefijo mutuo
 * entre términos/palabras de 4+ letras) en vez de "contiene en cualquier lado".
 */
import { filterUnitsBySearchTerms, resolveUnitQuery } from "../src/lib/waraUnitIntent.ts";

let failed = 0;
function assert(cond, label) {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}

function tokenizeSearchTerms(text) {
  const STOPWORDS = new Set(["mis", "las", "los", "del", "de", "la", "el", "en", "por"]);
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

const fleetConNombresRuidosos = [
  { movil_id: 1, patente: "GP30", unidad: "Mascotas GP30" },
  { movil_id: 2, patente: "NKL 952", unidad: "" },
  { movil_id: 3, patente: "LWK 7902", unidad: "BRtestes" },
];

console.log("— 'mas lista'/'mas unidades' NO matchean 'Mascotas' por casualidad —");
for (const msg of ["mas lista", "mas unidades", "mas info", "mas datos"]) {
  const matches = filterUnitsBySearchTerms(fleetConNombresRuidosos, tokenizeSearchTerms(msg));
  assert(matches.length === 0, `"${msg}" → 0 unidades (antes resolvía GP30/Mascotas por error)`);
}

console.log("\n— resolveUnitQuery('mas lista') no resuelve una unidad al azar —");
const resolvedMasLista = await resolveUnitQuery({
  rawText: "mas lista",
  threadText: "",
  units: fleetConNombresRuidosos,
});
assert(
  resolvedMasLista.intent === "list_fleet",
  `"mas lista" → intent list_fleet (obtuvo: ${resolvedMasLista.intent}/${resolvedMasLista.plate ?? "sin patente"})`,
);

console.log("\n— Búsqueda legítima por marca/nombre sigue funcionando (no se rompe con el fix) —");
const fleetWithSaveiro = [
  { movil_id: 1, patente: "AD 427 MC", unidad: "FORD RANGER" },
  { movil_id: 2, patente: "LWK 891", unidad: "VOLKSWAGEN SAVEIRO" },
];
for (const [text, label] of [
  ["que pasa con la saveiro", "'que pasa con la saveiro'"],
  ["saveiro", "'saveiro' (palabra exacta)"],
]) {
  const matches = filterUnitsBySearchTerms(fleetWithSaveiro, tokenizeSearchTerms(text));
  assert(
    matches.length === 1 && matches[0].patente === "LWK 891",
    `${label} → sigue encontrando la Saveiro real`,
  );
}

const fleetWithNissan = [
  { movil_id: 1, patente: "OST 223", unidad: "900-041" },
  { movil_id: 2, patente: "AH 562 SP", unidad: "NISSAN FRONTIER" },
];
const nissanResolved = await resolveUnitQuery({
  rawText: "Nissan",
  threadText: "",
  units: fleetWithNissan,
});
assert(
  nissanResolved.intent === "consult_status" && nissanResolved.plate === "AH562SP",
  "'Nissan' sigue resolviendo directo a AH562SP",
);

if (failed > 0) {
  console.error(`\n✗ ${failed} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ Verificación de matching por palabra completa (flota) OK");
