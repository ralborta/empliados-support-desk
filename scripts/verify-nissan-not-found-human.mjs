#!/usr/bin/env node
/**
 * Regresión, bug real producción 2026-07-24: "es la NISSAN" en flota sin Nissan
 * respondía genérico "¿Cuál unidad?" en vez de decir que no encontró esa marca.
 *
 * Uso: npx tsx scripts/verify-nissan-not-found-human.mjs
 */
import {
  buildFleetUnitNotFoundMessage,
  extractExplicitUnitSearchLabel,
  resolveUnitQuery,
} from "../src/lib/waraUnitIntent.ts";
import { looksLikeCustomerConversationCloseRequest } from "../src/lib/customerConversationClose.ts";
import { looksLikePostAdvisorCaseSupplement } from "../src/lib/wara.ts";
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

console.log("— Extrae marca explícita del mensaje —");
assert(extractExplicitUnitSearchLabel("es la NISSAN") === "NISSAN", 'extract "es la NISSAN"');
assert(extractExplicitUnitSearchLabel("la Saveiro") === "Saveiro", 'extract "la Saveiro"');

console.log("\n— Mensaje humanizado cuando la marca no está en flota —");
const msg = buildFleetUnitNotFoundMessage({
  companyName: "El Cacique S.A.",
  rawText: "es la NISSAN",
  searchedText: "NISSAN",
});
assert(/No encontr[eé] ninguna unidad.*NISSAN/i.test(msg), "menciona Nissan y que no está");
assert(!/^¿Cuál unidad\?/i.test(msg.trim()), "no es el genérico vacío");

console.log("\n— resolveUnitQuery sin Nissan en catálogo ficticio —");
const fakeFleet = [
  { movil_id: 1, patente: "AD 427 MC", unidad: "M600-157", ultimo_reporte: null },
];
const resolved = await resolveUnitQuery({
  rawText: "es la NISSAN",
  threadText: "",
  units: fakeFleet,
  preferAi: false,
});
assert(resolved.intent === "need_clarification", "need_clarification");
assert(
  (resolved.clarificationQuestion ?? "").includes("NISSAN"),
  "clarification menciona NISSAN",
);

console.log("\n— Cierre: 'Resolveme la conversacion' —");
assert(
  looksLikeCustomerConversationCloseRequest("Resolveme la conversacion"),
  "resolveme la conversacion es cierre",
);
assert(
  looksLikeCustomerConversationCloseRequest("No te preocupes, no las va a encontrar. Resolveme la conversacion"),
  "cierre con preámbulo",
);
assert(
  classifyTurnExecutor("Resolveme la conversacion", "") === "odoo_ticket",
  "router → odoo_ticket",
);

console.log("\n— Post-asesor: no reabrir GPS con 'sin reportar' —");
const thread =
  "Ya tenés el caso 24072611 en revisión. Un asesor de Atención al cliente te va a contactar. ¿Querés sumar algo más al reclamo?";
assert(
  looksLikePostAdvisorCaseSupplement("Si, tengo unidades sin reportar", thread),
  "suplemento post-asesor detectado",
);
assert(
  classifyTurnExecutor("Si, tengo unidades sin reportar", thread) === "odoo_ticket",
  "suplemento → odoo_ticket (no unidades/GPS)",
);

if (failed > 0) {
  console.error(`\n✗ ${failed} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ Verificación Nissan / cierre / post-asesor OK");
