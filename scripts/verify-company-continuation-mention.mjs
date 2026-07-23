#!/usr/bin/env node
/**
 * Regresión, bug real producción 2026-07-23: el cliente ya venía operando con "El
 * Cacique S.A.", preguntó "indicame en que empresa estoy operando actualmente" (se le
 * contestó, con la opción de "cambiar empresa" si quería) y respondió "quiero
 * continuar con el cacique" — una confirmación simple, sin querer cambiar nada.
 *
 * Ese mensaje NO califica como `looksLikeCompanySelection` (el "quiero" activa
 * `looksLikeOperationalIntent`, que la descarta a propósito para no pisar un pedido
 * operativo real) y no había ningún menú de empresa pendiente (`companyPickedThisTurn`
 * requiere eso). Sin ninguna rama que lo reconozca, caía al router genérico →
 * clasificador → ejecutor de unidades por defecto → el respaldo de "unidad activa"
 * (@/lib/activeUnit) repetía el último reporte de GPS ya mostrado (unidad AH 975 ST),
 * como si el cliente hubiese preguntado por el estado de una unidad — un loop confuso
 * cuando además el cliente insistió con "Quiero consultar por otras unidades" y el bot
 * volvió a repetir EXACTAMENTE lo mismo (ver scripts/verify-unit-rejection-loop.mjs
 * para ese segundo bug, de la misma captura).
 *
 * `matchCompanyContinuationMention` (@/lib/waraApi) generaliza esto contra los
 * contactos REALES del teléfono (no un catálogo fijo de nombres de empresa) — funciona
 * para cualquier empresa asociada, no solo "Wara"/"El Cacique".
 *
 * Uso: npx tsx scripts/verify-company-continuation-mention.mjs
 */
import { matchCompanyContinuationMention, looksLikeCompanySelection } from "../src/lib/waraApi.ts";

let failed = 0;
function assert(cond, label) {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}

const contacts = [
  { id: 1, nombre: "Juan Perez", empresa: "WARA" },
  { id: 2, nombre: "Emilio Gomez", empresa: "El Cacique S.A." },
];

console.log("— Bug real: 'quiero continuar con el cacique' NO califica como looksLikeCompanySelection —");
assert(
  !looksLikeCompanySelection("quiero continuar con el cacique"),
  "looksLikeCompanySelection('quiero continuar con el cacique') === false (el 'quiero' la descarta a propósito)",
);

console.log("\n— Pero SÍ debe reconocerse como continuación/confirmación de empresa —");
const continuationPhrases = [
  "quiero continuar con el cacique",
  "quiero continuar con El Cacique",
  "sigamos con Wara",
  "prefiero quedarme en el cacique",
  "dale, seguimos con wara",
];
console.log(
  "\n— Bug real #2: CAMBIO de empresa implícito con un verbo nuevo ('operar', no solo 'continuar/seguir') —",
);
const implicitSwitchPhrases = [
  "Quiero operar en Wara",
  "quiero operar en wara",
  "necesito trabajar con el cacique",
  "quiero pasarme a wara",
  "quiero cambiarme al cacique",
];
for (const text of implicitSwitchPhrases) {
  const matched = matchCompanyContinuationMention(text, contacts);
  assert(!!matched, `matchCompanyContinuationMention("${text}") encuentra un contacto (verbo distinto de continuar/seguir)`);
}
assert(
  matchCompanyContinuationMention("Quiero operar en Wara", contacts)?.empresa === "WARA",
  "'Quiero operar en Wara' matchea específicamente WARA",
);
for (const text of continuationPhrases) {
  const matched = matchCompanyContinuationMention(text, contacts);
  assert(!!matched, `matchCompanyContinuationMention("${text}") encuentra un contacto`);
}

assert(
  matchCompanyContinuationMention("quiero continuar con el cacique", contacts)?.empresa === "El Cacique S.A.",
  "'quiero continuar con el cacique' matchea específicamente El Cacique S.A. (no Wara)",
);
assert(
  matchCompanyContinuationMention("sigamos con Wara", contacts)?.empresa === "WARA",
  "'sigamos con Wara' matchea específicamente WARA",
);

console.log("\n— Sanity: mensajes sin la estructura 'continuar/seguir con X' no matchean nada —");
const nonMatches = [
  "quiero ver el estado de mi unidad",
  "también quiero el certificado",
  "no quiero ver esa es otra",
  "gracias!",
  "",
  "cual es el estado de la unidad AD 427 MC",
];
for (const text of nonMatches) {
  assert(
    matchCompanyContinuationMention(text, contacts) === null,
    `matchCompanyContinuationMention("${text}") === null`,
  );
}

console.log(
  "\n— Sanity: 'seguir/continuar con' + algo que NO es ninguna empresa real no matchea (evita falsos positivos por 'el ...') —",
);
const falsePositiveRisks = [
  "quiero continuar con el problema de la nissan",
  "sigamos con el mismo trámite",
  "continuemos con la consulta anterior",
];
for (const text of falsePositiveRisks) {
  assert(
    matchCompanyContinuationMention(text, contacts) === null,
    `matchCompanyContinuationMention("${text}") === null (no hay ninguna empresa real mencionada)`,
  );
}

console.log("\n— Sanity: sin contactos (teléfono no asociado a ninguna empresa en Wara) no rompe nada —");
assert(
  matchCompanyContinuationMention("quiero continuar con el cacique", []) === null,
  "sin contactos, devuelve null",
);

if (failed > 0) {
  console.error(`\n✗ ${failed} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ Verificación de continuación/confirmación de empresa OK");
