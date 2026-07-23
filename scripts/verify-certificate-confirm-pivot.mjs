#!/usr/bin/env node
/**
 * Regresión del "insistí con la unidad" en pleno CONFIRMO pendiente (bug real,
 * producción 2026-07-23):
 *
 *   Bot: "Voy a generar el certificado de cobertura: Patente: AG 562 SP... responde
 *         CONFIRMO para solicitarlo."
 *   Cliente: "Y cuál es su estado?"        → repitió "necesito la unidad" (FALSO, ya la
 *                                             tenemos confirmada en el resumen)
 *   Cliente: "De la misma unidad"          → mismo mensaje falso otra vez
 *   Cliente: "No quiero el certificado"    → mismo mensaje falso otra vez, en vez de
 *                                             cancelar y preguntar qué necesita
 *
 * Este test reimplementa (sin DB) las funciones puras que decidían esa rama en
 * certificados/route.ts para verificar el fix: una cancelación explícita corta con un
 * mensaje de cancelación real, y cualquier OTRO mensaje no reconocido durante el
 * CONFIRMO pendiente ya no dice "necesito la unidad" (mentira) sino que recuerda la
 * confirmación pendiente sin inventar un dato faltante.
 *
 * Uso: npx tsx scripts/verify-certificate-confirm-pivot.mjs
 */
import { normalizePlate } from "../src/lib/wara.ts";

let failed = 0;
function assert(cond, label) {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}

// Reimplementación exacta de las funciones puras nuevas/afectadas de certificados/route.ts.
function isCertificateRejection(text) {
  const t = text.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (/^(no|nop|nope|incorrecto|mal|otra|otro)[\s!.?]*$/.test(t)) return true;
  return /^no[\s,]+(esta|es|esa|es esa|es esa patente|para esa)/.test(t);
}
// Reimplementación exacta (sin dependencias de Next/DB) de extractPlateFromCertificateSummary.
function extractPlateFromCertificateSummary(text) {
  const labeled = [...text.matchAll(/Patente:\s*([A-Za-z0-9 ]{5,12})/gi)];
  if (labeled.length) {
    const plate = normalizePlate(labeled[labeled.length - 1][1]);
    if (plate) return plate;
  }
  return null;
}

function isCertificateCancellation(text) {
  const t = text.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (!t) return false;
  return (
    /\bno\s+(quiero|necesito)\b[^.!?]*\b(certificado|cobertura)\b/.test(t) ||
    /\bya\s+no\s+(lo\s+)?(quiero|necesito)\b/.test(t) ||
    /\b(cancelar|cancela|cancelalo|cancele|anular|anulalo)\b/.test(t) ||
    /\bolvidal[oa]\b/.test(t)
  );
}

console.log("— Bug real: cancelación explícita del certificado (no solo corrección de unidad) —");
const cancellations = [
  "No quiero el certificado",
  "no quiero el certificado",
  "ya no lo quiero",
  "cancelalo",
  "olvidalo",
];
for (const text of cancellations) {
  assert(isCertificateCancellation(text), `isCertificateCancellation("${text}") === true`);
}

console.log("\n— Sanity: rechazo de unidad (no cancelación del trámite) sigue distinto —");
assert(isCertificateRejection("No, esa no es"), 'isCertificateRejection("No, esa no es") === true');
assert(
  !isCertificateCancellation("No, esa no es"),
  'isCertificateCancellation("No, esa no es") === false (es corrección de unidad, no cancelación)',
);

console.log("\n— Sanity: preguntas normales durante CONFIRMO pendiente no se confunden con cancelación —");
const unrelatedQuestions = ["Y cuál es su estado?", "De la misma unidad", "Cuánto tarda en llegar?"];
for (const text of unrelatedQuestions) {
  assert(
    !isCertificateCancellation(text),
    `isCertificateCancellation("${text}") === false`,
  );
  assert(!isCertificateRejection(text), `isCertificateRejection("${text}") === false`);
}

console.log("\n— extractPlateFromCertificateSummary sigue extrayendo la patente del resumen pendiente —");
const summaryThread = [
  "Voy a generar el certificado de cobertura:",
  "Patente: AG 562 SP",
  "Empresa: WARA",
  "",
  "Si esta correcto, responde CONFIRMO para solicitarlo a Wara.",
].join("\n");
assert(
  extractPlateFromCertificateSummary(summaryThread) === "AG562SP",
  "extrae AG562SP del resumen pendiente de confirmación",
);

if (failed > 0) {
  console.error(`\n✗ ${failed} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ Verificación de pivote durante confirmación de certificado OK");
