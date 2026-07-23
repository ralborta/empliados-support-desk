#!/usr/bin/env node
/**
 * Regresión del bug real (producción, 2026-07-22): tras pedir un certificado con un
 * prefijo/marca que no está en la flota ("quiero un certificado para la patente NKL"),
 * el bot respondía con el mensaje genérico de "no encontré esa unidad" — un texto que
 * `certificateFlowState` no reconoce como parte del trámite de certificado. El hilo
 * quedaba en estado "none" y el próximo mensaje del cliente ("y la LWK") se enrutaba
 * al flujo general de unidades en vez de retomar el certificado: el bot terminaba
 * reportando estado de GPS/ignición y generando un caso, en vez de generar el
 * certificado pedido. Este test verifica que cualquier aclaración de unidad dentro del
 * trámite de certificado deja el hilo anclado en "awaiting_unit".
 *
 * Uso: npx tsx scripts/verify-certificate-flow-continuity.mjs
 */
import { anchorToCertificateUnitFlow, askCertificateUnitMessage } from "../src/lib/certificateFlowMessages.ts";
import { certificateFlowState } from "../src/lib/wara.ts";

let failed = 0;
function assert(cond, label) {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}

console.log("— Prefijo/patente no encontrada en el trámite de certificado ancla el hilo —");

const prefixNotFound =
  "No hay ninguna unidad en la flota de tu empresa con patente que empiece con NKL. " +
  "Ese prefijo no está en tu flota. Pasame la matrícula completa (ej. NKL 952) o escribí «listado de mis unidades».";
const anchoredPrefix = anchorToCertificateUnitFlow(prefixNotFound);
assert(
  certificateFlowState(`Cliente: quiero un certificado para la patente NKL\nBot: ${anchoredPrefix}`) ===
    "awaiting_unit",
  "mensaje de prefijo no encontrado, anclado, deja el hilo en awaiting_unit",
);
assert(
  certificateFlowState(`Cliente: quiero un certificado para la patente NKL\nBot: ${prefixNotFound}`) !==
    "awaiting_unit",
  "sanity check: el mensaje SIN anclar no se reconoce como awaiting_unit (por eso hacía falta el fix)",
);

const unitNotInFleet = `No encontré una unidad para "esa patente" en tu flota. Decime la patente exacta (ej. NKL 961) o un prefijo (ej. NKL).`;
const anchoredUnit = anchorToCertificateUnitFlow(unitNotInFleet);
assert(
  certificateFlowState(`Cliente: quiero un certificado para esa patente\nBot: ${anchoredUnit}`) === "awaiting_unit",
  "mensaje de unidad no encontrada, anclado, deja el hilo en awaiting_unit",
);

console.log("— anchorToCertificateUnitFlow es idempotente —");

const alreadyAskingUnit = askCertificateUnitMessage();
assert(
  anchorToCertificateUnitFlow(alreadyAskingUnit) === alreadyAskingUnit,
  "no duplica la frase si el mensaje ya la incluye",
);

if (failed > 0) {
  console.error(`\n✗ ${failed} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ Verificación de continuidad del trámite de certificado OK (sin pérdida de estado)");
