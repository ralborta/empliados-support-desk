#!/usr/bin/env node
/**
 * Bug real 2026-08-06: tras listar flota con "ALTAMIRANDA JOSE", el cliente pide
 * "estado de Altamiranda" / typo "Altamirano" y el bot pedía matrícula porque solo
 * buscaba marcas del catálogo cerrado (Nissan…), no etiquetas/nombres de flota.
 */
import {
  extractFreeTextUnitSearchCandidate,
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

const fleet = [
  { movil_id: 1, patente: "ALTAMIRANDA JOSE", unidad: "ALTAMIRANDA JOSE" },
  { movil_id: 2, patente: "AD427MC", unidad: "M300-001" },
  { movil_id: 3, patente: "ARIEL BLASCO", unidad: "ARIEL BLASCO" },
];

assert(
  extractFreeTextUnitSearchCandidate("Quiero el estado de Altamiranda") === "Altamiranda",
  "extrae Altamiranda de 'estado de…'",
);
assert(
  extractFreeTextUnitSearchCandidate("Perdón el estado de Altamiranda") === "Altamiranda",
  "extrae tras 'Perdón…'",
);
assert(
  extractFreeTextUnitSearchCandidate("Altamiranda") === "Altamiranda",
  "nombre suelto",
);
assert(looksLikeFleetUnitSearchInput("Quiero el estado de Altamiranda"), "es búsqueda de flota");
assert(
  shouldRouteTurnToUnidadesExecutor({
    selectionText: "Quiero el estado de Altamiranda",
    threadText: "",
  }),
  "ruta a unidades",
);

const uq = await resolveUnitQuery({
  rawText: "Quiero el estado de Altamiranda",
  threadText: "",
  units: fleet,
  preferAi: false,
});
assert(
  uq.intent === "consult_status" && /ALTAMIRANDA/i.test(uq.plate ?? ""),
  `resuelve Altamiranda (intent=${uq.intent}, plate=${uq.plate})`,
);

const typo = await resolveUnitQuery({
  rawText: "Quiero el estado de Altamirano",
  threadText: "",
  units: fleet,
  preferAi: false,
});
assert(
  typo.intent === "consult_status" && /ALTAMIRANDA/i.test(typo.plate ?? ""),
  `typo Altamirano → Altamiranda (intent=${typo.intent}, plate=${typo.plate})`,
);

const byHint = await resolveUnitQuery({
  rawText: "xyz tipografico",
  threadText: "",
  units: fleet,
  preferAi: false,
  nameHint: "Altamiranda",
});
assert(
  byHint.intent === "consult_status" && /ALTAMIRANDA/i.test(byHint.plate ?? ""),
  `nameHint override → Altamiranda`,
);

if (failed > 0) {
  console.error(`\n✗ ${failed} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ Búsqueda por nombre/etiqueta de flota (Altamiranda) OK");
