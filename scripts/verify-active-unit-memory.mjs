#!/usr/bin/env node
/**
 * Regresión de la "unidad activa" (@/lib/activeUnit) — memoria explícita en DB de la
 * última unidad resuelta, usada como respaldo cuando ni el mensaje actual ni el texto
 * del hilo traen ninguna señal reconocible de patente/marca/prefijo.
 *
 * Por qué hace falta esto (bugs reales, producción 2026-07-23, MISMO hilo de prueba,
 * después de resolver "Nissan" → AG 562 SP en la consulta de estado):
 *
 *   1. "Me podes decir q unidad estamos consultando?" — pregunta meta sobre el
 *      contexto, no matchea ninguna frase de looksLikeVagueUnitReference ("esa
 *      unidad", "la mencionada", etc.) ni ningún cue de GPS/estado — el bot volvía a
 *      pedir la matrícula en vez de recordar la unidad que se acababa de resolver.
 *   2. "Ok quiero obtener el certificado también" — "también" tampoco está (ni puede
 *      estar razonablemente) en el catálogo cerrado de referencias vagas — mismo
 *      resultado: se pedía la patente de nuevo para el certificado.
 *
 * En vez de seguir agregando frases sueltas a un catálogo cerrado de regex (patrón de
 * bug ya visto y corregido varias veces en esta auditoría), se guarda explícitamente
 * la última unidad resuelta en `Customer.activeUnit` y se usa como respaldo genérico
 * en cualquier trámite (estado/certificado/odómetro/mantenimiento) — sin depender de
 * reconocer la frase exacta con la que el cliente se refiere a "la misma unidad de
 * antes". Este test verifica la lógica PURA (sin DB): cuándo corresponde usar ese
 * respaldo y cuándo NO (para no pisar una unidad distinta que el cliente sí nombró).
 *
 * Uso: npx tsx scripts/verify-active-unit-memory.mjs
 */
import { shouldUseActiveUnitFallback, isActiveUnitFresh } from "../src/lib/activeUnit.ts";
import { detectPlate, looksLikeCertificateUnitReply, certificateFlowState } from "../src/lib/wara.ts";
import {
  looksLikePlateCorrectionRequest,
  looksLikeVehicleBrandOrUnitSearch,
} from "../src/lib/waraApi.ts";
import { looksLikeVagueUnitReference } from "../src/lib/waraUnitIntent.ts";

let failed = 0;
function assert(cond, label) {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}

// Reimplementación exacta del gate `genericNewRequest` de certificados/route.ts,
// ahora con el respaldo de unidad activa.
function isGenericCertificateRequest(text) {
  return /\b(certificado|cobertura|monitoreo|constancia)\b/i.test(text) && !detectPlate(text);
}
function looksLikeCertificateUnitSelection(text, threadText = "") {
  return (
    looksLikeCertificateUnitReply(text, threadText) ||
    looksLikePlateCorrectionRequest(text) ||
    looksLikeVehicleBrandOrUnitSearch(text)
  );
}
function computeGenericNewRequest(text, threadText, activeUnitPlate) {
  return (
    isGenericCertificateRequest(text) &&
    !detectPlate(text) &&
    !looksLikeCertificateUnitSelection(text, threadText) &&
    !looksLikeVagueUnitReference(text) &&
    !activeUnitPlate
  );
}

console.log("— Bug real #1: pregunta meta ('qué unidad estamos consultando?') debe activar el respaldo de unidad activa —");
assert(
  shouldUseActiveUnitFallback("Me podes decir q unidad estamos consultando?"),
  "shouldUseActiveUnitFallback('Me podes decir q unidad estamos consultando?') === true",
);
assert(
  shouldUseActiveUnitFallback("Quiero saber cuál consulté?"),
  "shouldUseActiveUnitFallback('Quiero saber cuál consulté?') === true",
);

console.log("\n— Bug real #2: 'también' (sin ninguna frase de referencia vaga reconocida) debe activar el respaldo —");
assert(
  shouldUseActiveUnitFallback("Ok quiero obtener el certificado también"),
  "shouldUseActiveUnitFallback('Ok quiero obtener el certificado también') === true",
);
const threadAfterNissan = [
  "Para revisar el GPS, la ignición o el reporte necesito la unidad: pasame la patente (ej. AD427MC) o la marca/nombre (ej. Nissan).",
  "La unidad AG 562 SP (NISSAN 2404 - AG 562 SP) está funcionando normalmente, enviando reportes y posición actualizados.",
].join("\n");
assert(
  !computeGenericNewRequest("Ok quiero obtener el certificado también", threadAfterNissan, "AG562SP"),
  "con unidad activa AG562SP, genericNewRequest es false: no corta antes de reusar la unidad activa",
);
assert(
  computeGenericNewRequest("Ok quiero obtener el certificado también", threadAfterNissan, null),
  "sanity: sin unidad activa (null), el mismo mensaje SÍ corta pidiendo la patente (comportamiento previo intacto)",
);

console.log("\n— Sanity: si el cliente nombra una unidad/patente explícita, NO corresponde usar la unidad activa —");
assert(
  !shouldUseActiveUnitFallback("Es la Toyota"),
  "shouldUseActiveUnitFallback('Es la Toyota') === false (marca explícita, no reusar la unidad activa)",
);
assert(
  !shouldUseActiveUnitFallback("La patente es AD 427 MC"),
  "shouldUseActiveUnitFallback('La patente es AD 427 MC') === false (patente explícita)",
);
assert(
  !shouldUseActiveUnitFallback("no es la OST 223, es la AD 427 MC"),
  "shouldUseActiveUnitFallback('no es la OST 223, es la AD 427 MC') === false (corrección explícita)",
);

console.log("\n— TTL: una unidad activa vieja (> 45 min) se considera vencida —");
const now = Date.now();
const fresh = { resolvedAt: new Date(now - 5 * 60 * 1000).toISOString() };
const stale = { resolvedAt: new Date(now - 46 * 60 * 1000).toISOString() };
assert(isActiveUnitFresh(fresh, now), "unidad activa de hace 5 minutos sigue vigente");
assert(!isActiveUnitFresh(stale, now), "unidad activa de hace 46 minutos ya venció");

console.log("\n— Sanity: certificateFlowState no depende de esta unidad activa (no se pisa ningún estado existente) —");
assert(
  certificateFlowState(threadAfterNissan) !== "awaiting_unit",
  "el hilo de estado/GPS nunca puso al trámite de certificado en 'awaiting_unit' (confirma que la unidad activa cubre un gap real, no duplica lógica existente)",
);

if (failed > 0) {
  console.error(`\n✗ ${failed} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ Verificación de memoria de unidad activa OK");
