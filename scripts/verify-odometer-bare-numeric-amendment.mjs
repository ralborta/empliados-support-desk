#!/usr/bin/env node
/**
 * Regresión — Bug real, producción 2026-07-29 (captura del cliente): con la confirmación
 * YA mostrada ("Voy a registrar: ... Odómetro: 133567 km ... respondé CONFIRMO"), el
 * cliente escribió "No me equivoqué" (aviso de error) y después mandó directamente el
 * valor corregido "186550" (sin decir "odómetro"). El bot ignoró el número y repitió el
 * recordatorio genérico dos veces seguidas — el dato corregido nunca se tomó.
 *
 * Esta suite reimplementa (sin importar desde route.ts, que no exporta helpers internos,
 * siguiendo el mismo patrón que otras regresiones de este archivo) la lógica exacta de
 * parseBareNumericPendingAmendment + amendsPendingOdoConfirm agregada en el fix, y prueba
 * looksLikeGenericCorrectionIntent (exportada de verdad) para "me equivoqué".
 */
import assert from "node:assert";
import { looksLikeGenericCorrectionIntent } from "../src/lib/wara.ts";

let passed = 0;
function check(label, cond) {
  assert.ok(cond, label);
  passed++;
  console.log(`  ✓ ${label}`);
}

// Copia exacta de la función agregada en route.ts (ver comentario del bug ahí).
function parseBareNumericPendingAmendment(rawText) {
  const t = rawText
    .trim()
    .replace(/\./g, "")
    .replace(/,/g, ".")
    .replace(/\s+/g, " ");
  const m = t.match(/^(\d{1,8}(?:\.\d{1,2})?)\s*(?:km\.?|kms?\.?|hs?\.?|horas?)?$/i);
  if (!m) return undefined;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : undefined;
}

console.log("▶ parseBareNumericPendingAmendment — caso real del cliente");
check('"186550" se parsea como 186550', parseBareNumericPendingAmendment("186550") === 186550);
check('"186.550" (separador de miles) se parsea como 186550', parseBareNumericPendingAmendment("186.550") === 186550);
check('"186550 km" se parsea como 186550', parseBareNumericPendingAmendment("186550 km") === 186550);
check('"186550km" (sin espacio) se parsea como 186550', parseBareNumericPendingAmendment("186550km") === 186550);
check('"350 hs" se parsea como 350', parseBareNumericPendingAmendment("350 hs") === 350);
check('"350,5" (decimal) se parsea como 350.5', parseBareNumericPendingAmendment("350,5") === 350.5);

console.log("\n▶ parseBareNumericPendingAmendment — NO debe confundir texto real con un número suelto");
check('"CONFIRMO" no es un número', parseBareNumericPendingAmendment("CONFIRMO") === undefined);
check('"no confirmo" no es un número', parseBareNumericPendingAmendment("no confirmo") === undefined);
check('"AD427MC" (patente) no es un número', parseBareNumericPendingAmendment("AD427MC") === undefined);
check('"la patente es AD427MC" no es un número', parseBareNumericPendingAmendment("la patente es AD427MC") === undefined);
check('"No me equivoqué" no es un número (va por otro lado, ver más abajo)', parseBareNumericPendingAmendment("No me equivoqué") === undefined);
check('texto vacío no es un número', parseBareNumericPendingAmendment("") === undefined);

console.log("\n▶ amendsPendingOdoConfirm — combinación real (solo importa si hay confirmación pendiente)");
function computeAmends(pendingOdoConfirm, rawText, looksLikeAmendmentFn) {
  const bareNumericAmendmentValue = pendingOdoConfirm ? parseBareNumericPendingAmendment(rawText) : undefined;
  return pendingOdoConfirm && (looksLikeAmendmentFn(rawText) || bareNumericAmendmentValue !== undefined);
}
import { looksLikeOdometerPendingDataAmendment } from "../src/lib/wara.ts";

check(
  '"186550" CON confirmación pendiente SÍ es una enmienda (el bug real)',
  computeAmends(true, "186550", looksLikeOdometerPendingDataAmendment) === true,
);
check(
  '"186550" SIN confirmación pendiente NO se trata como enmienda (no hay nada que enmendar)',
  computeAmends(false, "186550", looksLikeOdometerPendingDataAmendment) === false,
);
check(
  '"CONFIRMO" con confirmación pendiente NO se trata como enmienda (sigue siendo una confirmación)',
  computeAmends(true, "CONFIRMO", looksLikeOdometerPendingDataAmendment) === false,
);
check(
  '"el odómetro correcto es 350" sigue reconociéndose (comportamiento previo intacto)',
  computeAmends(true, "el odómetro correcto es 350", looksLikeOdometerPendingDataAmendment) === true,
);

console.log('\n▶ looksLikeGenericCorrectionIntent — "me equivoqué" (frase real del cliente)');
check('"Me equivoqué" se reconoce como intención de corrección', looksLikeGenericCorrectionIntent("Me equivoqué") === true);
check('"No me equivoqué" (frase real, "no" como muletilla) también se reconoce', looksLikeGenericCorrectionIntent("No me equivoqué") === true);
check('"me equivoco" también se reconoce', looksLikeGenericCorrectionIntent("me equivoco") === true);
check('"me confundí" también se reconoce', looksLikeGenericCorrectionIntent("me confundí") === true);
check('un saludo normal no es intención de corrección', looksLikeGenericCorrectionIntent("hola, buenas") === false);
check('"CONFIRMO" no se confunde con intención de corrección', looksLikeGenericCorrectionIntent("CONFIRMO") === false);

console.log(`\n✅ ${passed} checks pasaron.`);
