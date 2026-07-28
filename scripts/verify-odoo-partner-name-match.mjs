#!/usr/bin/env node
/**
 * Regresión — Bug real, producción 2026-07-28: el cliente reportó "está generando
 * contactos en Odoo" para El Cacique S.A. Causa: el alias configurado ("El Cacique S.A.")
 * no matcheaba el partner real ya cargado en Odoo ("El Cacique Sa", sin puntos) por
 * ninguna búsqueda de nombre (exacta/prefijo/contiene), así que `findOrCreatePartner`
 * creaba un partner NUEVO cada vez que se escalaba un ticket para esa empresa.
 *
 * Fix: (1) `partnerId` explícito en la config para saltear la búsqueda por nombre en este
 * caso puntual, y (2) `compactPartnerToken` / `pickPartnerByCompactMatch` como fallback
 * genérico en `findPartnerByName` para reconocer variantes societarias equivalentes
 * ("S.A." / "SA" / "Sa") en cualquier otra empresa a futuro.
 */
import assert from "node:assert";
import { compactPartnerToken, pickPartnerByCompactMatch } from "../src/lib/odooApi.ts";
import { resolveOdooPartnerLookup, resolveOdooPartnerCompanyName } from "../src/config/odooPartnerAliases.ts";

let passed = 0;
function check(label, cond) {
  assert.ok(cond, label);
  passed++;
  console.log(`  ✓ ${label}`);
}

console.log("▶ compactPartnerToken ignora puntos/mayúsculas/espacios");
check(
  '"El Cacique S.A." === "El Cacique Sa" (compacto)',
  compactPartnerToken("El Cacique S.A.") === compactPartnerToken("El Cacique Sa"),
);
check(
  '"El Cacique S.A." === "el cacique sa" (compacto)',
  compactPartnerToken("El Cacique S.A.") === compactPartnerToken("el cacique sa"),
);
check(
  "empresas distintas no compactan igual",
  compactPartnerToken("El Cacique S.A.") !== compactPartnerToken("Di Ce Tours Srl"),
);

console.log("\n▶ pickPartnerByCompactMatch — caso real El Cacique");
const candidatesRealCase = [
  { id: 320, name: "El Cacique Sa" },
  { id: 79, name: "AGRICOLA CACIQUE ANGACO SRL" },
];
const match = pickPartnerByCompactMatch(candidatesRealCase, "El Cacique S.A.");
check("matchea el partner histórico #320 (\"El Cacique Sa\")", match?.id === 320);

console.log("\n▶ pickPartnerByCompactMatch — nombres cortos no matchean por error");
check(
  "términos muy cortos (<5 compacto) no matchean nada",
  pickPartnerByCompactMatch([{ id: 1, name: "SA" }], "SA") === null,
);

console.log("\n▶ pickPartnerByCompactMatch — ambigüedad (duplicado ya creado por el bug)");
const candidatesAmbiguous = [
  { id: 320, name: "El Cacique Sa" },
  { id: 34367, name: "El Cacique S.A." },
];
const ambiguousMatch = pickPartnerByCompactMatch(candidatesAmbiguous, "El Cacique SA");
check(
  "ante ambigüedad, prefiere el id más chico (partner más antiguo)",
  ambiguousMatch?.id === 320,
);

console.log("\n▶ pickPartnerByCompactMatch — sin coincidencias no inventa nada");
check(
  "empresa sin ningún candidato compatible devuelve null",
  pickPartnerByCompactMatch([{ id: 1, name: "Otra Empresa SRL" }], "El Cacique S.A.") === null,
);

console.log("\n▶ Config: alias con partnerId fijo evita la búsqueda por nombre");
for (const variant of ["El Cacique S.A.", "el cacique sa", "El Cacique Sa", "cacique", "el cacique"]) {
  const lookup = resolveOdooPartnerLookup(variant);
  check(`"${variant}" resuelve a partnerId=320`, lookup?.partnerId === 320);
}
check(
  "resolveOdooPartnerCompanyName devuelve el nombre real de Odoo",
  resolveOdooPartnerCompanyName("El Cacique S.A.") === "El Cacique Sa",
);

console.log("\n▶ No hay regresión en otro alias existente (Di Ce Tours)");
check(
  '"dicetour" sigue resolviendo a Di Ce Tours Srl',
  resolveOdooPartnerLookup("dicetour")?.odooName === "Di Ce Tours Srl, WARA DICETOURS",
);

console.log(`\n✓ ${passed} checks OK — verify-odoo-partner-name-match`);
