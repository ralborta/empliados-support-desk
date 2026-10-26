#!/usr/bin/env node
/**
 * Regresión P0 memoria/contexto Kira (capturas prod 2026-09-18):
 * 1. «Fin» cierra; no «Tomé la referencia Fin»
 * 2. «No la veo en mi sistema» no busca unidad «veo»
 * 3. Continuidad GPS ofrece next-step (no re-dump)
 * 4. extractBrandSearchLabel no toma verbos de percepción
 *
 * Uso: npx tsx scripts/verify-kira-memory-p0.mjs
 */
import { looksLikeCustomerConversationCloseRequest } from "../src/lib/customerConversationCloseDetect.ts";
import {
  extractBrandSearchLabel,
  extractFreeTextUnitSearchCandidate,
  looksLikePlatformUnitVisibilityComplaint,
} from "../src/lib/waraUnitIntent.ts";
import {
  buildGpsContinuityNextStepReply,
  looksLikeGpsStatusContinuityReply,
  looksLikeGpsTopicChangeReply,
  threadHasRecentGpsContext,
} from "../src/lib/waraGpsSummary.ts";
import { shouldClarifyUnitWithoutStatusAction } from "../src/lib/utteranceUnderstanding.ts";

let failed = 0;
function assert(cond, label) {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}

console.log("— P0.1 cierre Fin —");
assert(looksLikeCustomerConversationCloseRequest("Fin") === true, "Fin → cierre");
assert(looksLikeCustomerConversationCloseRequest("fin") === true, "fin → cierre");
assert(looksLikeCustomerConversationCloseRequest("Cancelar") === false, "Cancelar solo ≠ cierre conversación");
assert(
  looksLikeCustomerConversationCloseRequest("Dato para cerrar la consulta o tramite en curso") ===
    true,
  "dato para cerrar consulta → cierre",
);

console.log("— P0.2 no buscar «veo» —");
assert(
  looksLikePlatformUnitVisibilityComplaint("No la veo en mi sistema") === true,
  "detecta queja de visibilidad",
);
assert(extractBrandSearchLabel("No la veo en mi sistema") === null, "brand label no es veo");
assert(
  extractFreeTextUnitSearchCandidate("No la veo en mi sistema") === null,
  "free text no es veo",
);
assert(extractBrandSearchLabel("estado de la Altamiranda")?.toLowerCase().includes("altamiranda"), "sigue extrayendo Altamiranda");
assert(
  extractFreeTextUnitSearchCandidate("estado de Altamiranda")?.toLowerCase().includes("altamiranda"),
  "free text sigue extrayendo Altamiranda",
);

console.log("— P0.3 continuidad GPS sin re-loop —");
assert(
  looksLikeGpsStatusContinuityReply("Seguimos en el estado de la unidad") === true,
  "seguimos en el estado",
);
assert(
  looksLikeGpsStatusContinuityReply("Seguimos con el estado de la misma unidad") === true,
  "seguimos con el estado",
);
assert(looksLikeGpsTopicChangeReply("cambiamos de tema") === true, "cambiamos de tema");
const next = buildGpsContinuityNextStepReply("AH 745 NR");
assert(/Seguimos con el estado/.test(next), "next-step menciona continuidad");
assert(!/Funcionamiento normal|Último reporte|Coordenadas/.test(next), "next-step no re-dump GPS");
assert(
  threadHasRecentGpsContext(
    "El estado GPS de la unidad AH 745 NR es el siguiente:\n✅ Funcionamiento normal\n📍 Coordenadas: -32.9, -68.8\n¿Seguimos con el estado de la unidad o cambiamos de tema?",
  ),
  "detecta contexto GPS reciente",
);

console.log("— P0.4 Fin no es unit_reference clarify —");
assert(
  shouldClarifyUnitWithoutStatusAction({
    referent: "vehicle_unit",
    confidence: 0.9,
    clarifyQuestion: null,
    action: "unit_reference",
    unitRef: { kind: "name", value: "Fin" },
  }) === true,
  "clarify helper aún marca Fin si llega (el gate real es close detect antes)",
);
assert(
  looksLikeCustomerConversationCloseRequest("Fin") === true,
  "close detect gana antes del clarify",
);

if (failed) {
  console.error(`\n✗ ${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("\n✓ verify-kira-memory-p0 OK");
