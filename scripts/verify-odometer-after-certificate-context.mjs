#!/usr/bin/env node
/**
 * Regresión bug real 2026-07-30 (captura AD 626 UG):
 * consulta ignición → certificado confirmado → "Podemos cambiar el odometro?"
 * debe reusar la patente de sesión, no pedirla de nuevo. Follow-ups "De esta patente"
 * / "Esta misma" deben ir al executor odómetro, no al agente.
 *
 * Uso: npx tsx scripts/verify-odometer-after-certificate-context.mjs
 */
import {
  looksLikeExplicitOdometerUpdateRequest,
  threadHasActiveOdometerFlow,
} from "../src/lib/wara.ts";
import {
  looksLikeVagueUnitReference,
  shouldRouteTurnToOdometerExecutor,
} from "../src/lib/waraUnitIntent.ts";
import { shouldUseActiveUnitFallback } from "../src/lib/activeUnit.ts";

let failed = 0;
function assert(cond, label) {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}

const certThread = [
  "Cliente: Está reportando??",
  "Atilio: Sí, la unidad AD 626 UG (M300-133) está reportando una falla de ignición.",
  "Cliente: Me generas un certificado?",
  "Atilio: Voy a generar el certificado para la unidad con patente AD 626 UG perteneciente a El Cacique S.A. ¿Confirmás?",
  "Cliente: Confirmo",
  "Atilio: Listo, acá tenés el certificado para la patente AD 626 UG: https://example.com/cert.pdf",
].join("\n");

const odoAskThread = [
  certThread,
  "Cliente: Podemos cambiar el odometro?",
  "Atilio: Para registrar el cambio de odómetro necesito la patente de la unidad. ¿Cuál es? (podés usar guiones, ej. AB 006 EX, o decime la marca/nombre)",
].join("\n");

console.log("— Arranque odómetro tras certificado —");
const odoStart = "Podemos cambiar el odometro?";
assert(
  looksLikeExplicitOdometerUpdateRequest(odoStart),
  "detecta intención de cambio de odómetro",
);
assert(
  shouldUseActiveUnitFallback(odoStart),
  "califica para reusar activeUnit (sin patente en el mensaje)",
);

console.log("\n— Referencias vagas post-pedido de patente —");
for (const text of ["De esta patente", "Esta misma", "La misma patente"]) {
  assert(looksLikeVagueUnitReference(text), `looksLikeVagueUnitReference("${text}")`);
  assert(
    shouldRouteTurnToOdometerExecutor({
      selectionText: text,
      threadText: odoAskThread,
    }),
    `shouldRouteTurnToOdometerExecutor("${text}") → odometro (no agente)`,
  );
}

console.log("\n— Trámite odómetro activo tras pedir patente —");
assert(
  threadHasActiveOdometerFlow(odoAskThread),
  "threadHasActiveOdometerFlow tras pedido de patente odómetro",
);

if (failed > 0) {
  console.error(`\n✗ ${failed} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ Odómetro mantiene hilo tras certificado OK");
