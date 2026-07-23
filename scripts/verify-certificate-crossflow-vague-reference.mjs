#!/usr/bin/env node
/**
 * Regresión del bug real (producción, 2026-07-23): el cliente resuelve una unidad en
 * el flujo de consulta de ESTADO/GPS ("quiero ver el estado de la Nissan" → AG 562 SP)
 * y a continuación pide un certificado para "esa unidad". El bot volvía a pedir la
 * patente desde cero, ignorando que la unidad ya estaba establecida en el hilo.
 *
 * Causa raíz: en src/app/api/wara/certificados/route.ts, `genericNewRequest` (el gate
 * que decide si cortar temprano pidiendo la unidad, ANTES de intentar resolvePlateWithWaraFleet)
 * dependía de `looksLikeCertificateUnitSelection(text)`, que a su vez exige que
 * `certificateFlowState(threadText) === "awaiting_unit"` para reconocer una referencia
 * vaga como "esa unidad" — es decir, solo funcionaba si el propio trámite de
 * certificado ya había preguntado antes por la unidad. Como la unidad se estableció en
 * OTRO trámite (consulta de estado, no certificado), esa condición nunca se cumplía y
 * el gate cortaba sin darle la chance a la resolución contextual real de intentarlo.
 *
 * Este test reproduce el cálculo de `genericNewRequest` (reimplementado en base al
 * código real de certificados/route.ts) para confirmar que, con el fix, una referencia
 * vaga NO corta el flujo temprano — y que `resolveUnitQuery` (llamado después, vía
 * resolvePlateWithWaraFleet) sí resuelve la unidad ya establecida en el hilo.
 *
 * Uso: npx tsx scripts/verify-certificate-crossflow-vague-reference.mjs
 */
import { resolveUnitQuery, looksLikeVagueUnitReference } from "../src/lib/waraUnitIntent.ts";
import { detectPlate, threadTextSinceCompanySelection, certificateFlowState, looksLikeCertificateUnitReply } from "../src/lib/wara.ts";
import { looksLikePlateCorrectionRequest, looksLikeVehicleBrandOrUnitSearch } from "../src/lib/waraApi.ts";

let failed = 0;
function assert(cond, label) {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}

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
function computeGenericNewRequest(text, threadText) {
  return (
    isGenericCertificateRequest(text) &&
    !detectPlate(text) &&
    !looksLikeCertificateUnitSelection(text, threadText) &&
    !looksLikeVagueUnitReference(text)
  );
}

const fleet = [{ movil_id: 1, patente: "AG 562 SP", unidad: "NISSAN 2404" }];

const threadText = [
  "Perfecto, sigo con WARA. ¿En qué te puedo ayudar?",
  "Quiero ver el estado de la Nissan",
  "La unidad AG 562 SP (NISSAN 2404 - AG 562 SP) está detenida. La ignición está apagada y la última posición coincide con ese estado.",
].join("\n");
const text = "Ok me podes emitir un certificado para esa unidad?";

console.log("— El certificado NO debe cortar temprano ante una referencia vaga a una unidad ya resuelta en OTRO trámite —");
assert(certificateFlowState(threadText) !== "awaiting_unit", "sanity: el trámite de certificado nunca estuvo 'awaiting_unit' (la unidad se resolvió en consulta de estado)");
assert(!computeGenericNewRequest(text, threadText), "genericNewRequest es false: no corta antes de intentar resolver por contexto");

console.log("\n— La resolución real (resolveUnitQuery, como la usa resolvePlateWithWaraFleet) toma la unidad ya confirmada —");
const scopedThread = threadTextSinceCompanySelection(threadText);
const resolved = await resolveUnitQuery({
  rawText: text,
  threadText: scopedThread,
  units: fleet,
  preferAi: true,
  certificateContext: true,
});
assert(resolved.intent === "consult_status" && resolved.plate === "AG562SP", `resuelve AG562SP (obtuvo intent=${resolved.intent} plate=${resolved.plate ?? "-"})`);

console.log("\n— Sanity: un pedido de certificado genuinamente sin ninguna unidad mencionada SÍ debe pedir la patente —");
const freshThread = "Perfecto, sigo con WARA. ¿En qué te puedo ayudar?";
const freshText = "Quiero un certificado de cobertura";
assert(computeGenericNewRequest(freshText, freshThread), "sin ninguna unidad en el hilo, genericNewRequest sigue siendo true (pide la patente, como corresponde)");

if (failed > 0) {
  console.error(`\n✗ ${failed} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ Verificación de referencia vaga cruzando de trámite (estado → certificado) OK");
