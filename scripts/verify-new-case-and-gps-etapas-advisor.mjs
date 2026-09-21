#!/usr/bin/env node
/**
 * Bug real 2026-08-20:
 * 1) "ABRIR UN NUEVO CASO" reutilizaba el caso abierto en vez de cerrar y abrir uno nuevo.
 * 2) "NO REPORTA ETAPAS DE LA VUELTA" se interpretaba como unidad «VUELTA» en flota
 *    en vez de GPS → asesor humano.
 *
 * Uso: npx tsx scripts/verify-new-case-and-gps-etapas-advisor.mjs
 */
import {
  looksLikeExplicitReclamoOrTicketRequest,
  looksLikeGpsFeatureIssueForAdvisor,
  looksLikeOpenNewCaseRequest,
} from "../src/lib/waraApi.ts";
import { looksLikePostAdvisorCaseSupplement } from "../src/lib/wara.ts";
import { classifyTurnExecutor } from "../src/lib/whatsappTurnRouter.ts";
import { extractFreeTextUnitSearchCandidate } from "../src/lib/waraUnitIntent.ts";

let failed = 0;
function assert(cond, label) {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}

const advisorThread =
  "Ya existe un caso abierto para este reclamo. Un asesor de Atención al Cliente lo va a revisar. Ya tenés un caso en revisión. Un asesor de Atención al cliente te va a contactar por este medio. ¿Querés sumar algo más al reclamo?";

console.log("— Abrir un nuevo caso —");
for (const text of [
  "ABRIR UN NUEVO CASO",
  "abrir un nuevo caso",
  "necesito abrir un nuevo caso",
  "quiero crear otro caso",
]) {
  assert(looksLikeOpenNewCaseRequest(text), `looksLikeOpenNewCaseRequest("${text}")`);
  assert(
    classifyTurnExecutor(text, advisorThread) === "odoo_ticket",
    `classify("${text}") → odoo_ticket`,
  );
}

console.log("\n— GPS etapas de la vuelta → asesor (no flota) —");
const gpsMsg = "NO REPORTA ETAPAS DE LA VUELTA.";
assert(looksLikeGpsFeatureIssueForAdvisor(gpsMsg), "looksLikeGpsFeatureIssueForAdvisor");
assert(looksLikeExplicitReclamoOrTicketRequest(gpsMsg), "looksLikeExplicitReclamoOrTicketRequest (GPS feature)");
assert(
  classifyTurnExecutor(gpsMsg, advisorThread) === "odoo_ticket",
  `classify("${gpsMsg}") → odoo_ticket (no unidades)`,
);
assert(
  looksLikePostAdvisorCaseSupplement(gpsMsg, advisorThread),
  "post-advisor: se anota al caso abierto",
);
assert(
  extractFreeTextUnitSearchCandidate(gpsMsg) === null,
  "no extrae «VUELTA» como nombre de unidad",
);

console.log("\n— Sanity: consulta GPS con patente sigue en unidades —");
assert(
  !looksLikeGpsFeatureIssueForAdvisor("NKL 961 no reporta etapas de la vuelta"),
  "con patente NO es feature-issue-only (tiene unidad)",
);
assert(
  classifyTurnExecutor("estado gps de NKL 961", "") === "unidades",
  "estado gps con patente → unidades",
);

if (failed > 0) {
  console.error(`\n✗ ${failed} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ Nuevo caso + GPS etapas → asesor OK");
