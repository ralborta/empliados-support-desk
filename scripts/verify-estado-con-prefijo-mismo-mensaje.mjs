#!/usr/bin/env node
/**
 * Bug real 2026-08-06: "Ahora quiero saber el estado de una unidad la q empieza con ad"
 * disparaba looksLikeGenericUnitConsultWithoutPlate → pedía patente en vez de listar AD.
 */
import { extractPlatePrefixFromMessage } from "../src/lib/wara.ts";
import { looksLikeGenericUnitConsultWithoutPlate } from "../src/lib/waraApi.ts";
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

const msg = "Ahora quiero saber el estado de una unidad la q empieza con ad";

assert(extractPlatePrefixFromMessage(msg) === "AD", `prefijo AD (${extractPlatePrefixFromMessage(msg)})`);
assert(looksLikeFleetUnitSearchInput(msg), "es búsqueda de flota");
assert(
  !looksLikeGenericUnitConsultWithoutPlate(msg),
  "NO es 'sin patente' (ya dio prefijo)",
);
assert(
  shouldRouteTurnToUnidadesExecutor({ selectionText: msg, threadText: "" }),
  "ruta a unidades",
);

const fleet = [
  { movil_id: 1, patente: "AD427MC", unidad: "1" },
  { movil_id: 2, patente: "AD626UJ", unidad: "2" },
  { movil_id: 3, patente: "XX111AA", unidad: "3" },
];
const uq = await resolveUnitQuery({
  rawText: msg,
  threadText: "",
  units: fleet,
  preferAi: false,
});
assert(
  uq.intent === "need_clarification" && (uq.candidatePlates ?? []).length === 2,
  `lista AD (intent=${uq.intent}, n=${(uq.candidatePlates ?? []).length})`,
);
assert(/empiezan con AD/i.test(uq.clarificationQuestion ?? ""), "mensaje lista prefijo AD");

// Genérico SIN prefijo sigue pidiendo unidad.
assert(
  looksLikeGenericUnitConsultWithoutPlate("Ahora quiero saber el estado de una unidad"),
  "sin prefijo → sí es genérico",
);

if (failed > 0) {
  console.error(`\n✗ ${failed} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ estado + prefijo en el mismo mensaje → resuelve flota");
