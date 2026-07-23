#!/usr/bin/env node
/**
 * Regresión, bug real producción 2026-07-23: el cliente escribió "Buenos dias,
 * necesito abrir un nuevo caso" (tras haber cerrado su caso anterior) y el bot
 * respondió "Encontré 8 unidades parecidas (... M600-071 NUEVO ...). Decime la
 * matrícula exacta" — buscó "nuevo" (el adjetivo de "nuevo caso") como si fuera parte
 * de un nombre de unidad, porque varias unidades reales de la flota tienen "NUEVO" en
 * su nombre. "Lo peor" (como bien lo resumió el cliente): pidió abrir un caso nuevo y
 * el bot ni siquiera entendió que quería algo nuevo, de cero.
 *
 * Causa: `looksLikeExplicitReclamoOrTicketRequest` (@/lib/waraApi) exigía que el
 * sustantivo ("caso"/"ticket"/"reclamo") viniera PEGADO al verbo ("abrir un caso",
 * "necesito un caso") — cualquier adjetivo intermedio como "nuevo" ya rompía el
 * match, así que el mensaje nunca calificaba como pedido de ticket y caía al router
 * genérico → ejecutor de unidades por defecto, donde la búsqueda por términos sueltos
 * (extractSearchTerms) encontró "nuevo" como término "conocido" (aparece en nombres
 * reales de unidades) y devolvió una lista de unidades sin relación alguna.
 *
 * Fix: tolerar cualquier palabra intermedia corta entre el verbo y el sustantivo
 * (mismo patrón que "resolver el ACTUAL caso", ver
 * verify-close-case-resolver-verb.mjs) en vez de exigir adyacencia exacta.
 *
 * Uso: npx tsx scripts/verify-new-case-request-not-fleet-search.mjs
 */
import { looksLikeExplicitReclamoOrTicketRequest } from "../src/lib/waraApi.ts";
import { classifyTurnExecutor } from "../src/lib/whatsappTurnRouter.ts";

let failed = 0;
function assert(cond, label) {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}

console.log("— Bug real: 'necesito abrir un NUEVO caso' (adjetivo intermedio) ahora SÍ pide ticket —");
const newCaseRequests = [
  "Buenos dias, necesito abrir un nuevo caso",
  "necesito abrir un nuevo caso",
  "quiero abrir otro caso",
  "necesito abrir un ticket nuevo",
  "quiero generar un nuevo reclamo",
];
for (const text of newCaseRequests) {
  assert(
    looksLikeExplicitReclamoOrTicketRequest(text),
    `looksLikeExplicitReclamoOrTicketRequest("${text}") === true`,
  );
  assert(
    classifyTurnExecutor(text, "") === "odoo_ticket",
    `classifyTurnExecutor("${text}") === "odoo_ticket" (no cae al ejecutor de unidades por defecto)`,
  );
}

console.log("\n— Sanity: pedidos ya existentes (sin palabra intermedia) siguen intactos —");
const preExisting = ["necesito un caso", "quiero un ticket", "abrir un caso", "quiero un reclamo"];
for (const text of preExisting) {
  assert(
    looksLikeExplicitReclamoOrTicketRequest(text),
    `looksLikeExplicitReclamoOrTicketRequest("${text}") === true (comportamiento previo intacto)`,
  );
}

console.log(
  "\n— Sanity: consultas de GPS/unidad reales NO se confunden con pedido de ticket —",
);
const notTicketRequests = [
  "quiero ver el estado de mi unidad",
  "necesito saber si la Nissan está reportando",
  "AD 427 MC",
];
for (const text of notTicketRequests) {
  assert(
    !looksLikeExplicitReclamoOrTicketRequest(text),
    `looksLikeExplicitReclamoOrTicketRequest("${text}") === false`,
  );
}

if (failed > 0) {
  console.error(`\n✗ ${failed} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ Verificación de pedido de caso nuevo (no confundido con búsqueda de flota) OK");
