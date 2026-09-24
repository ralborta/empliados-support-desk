#!/usr/bin/env node
/**
 * Bug real 2026-08-20: cliente manda captura GPS + "ADJUNTO IMAGEN".
 * Sin {aiImage} de BBC: pedir detalle por escrito / derivar con aviso.
 * Con {aiImage}: ver scripts/verify-bbc-ai-image.mjs
 *
 * Uso: npx tsx scripts/verify-no-image-analysis.mjs
 */
import {
  looksLikeCustomerImageAttachmentCue,
  looksLikeInboundMediaOnlyEvent,
  NO_IMAGE_ANALYSIS_REPLY,
  withNoImageAnalysisNotice,
} from "../src/lib/inboundImagePolicy.ts";
import { looksLikeGpsFeatureIssueForAdvisor } from "../src/lib/waraApi.ts";
import { shouldRouteGpsConsultToUnidades } from "../src/lib/gpsConsultRouting.ts";
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

console.log("— Media sola (_event_image__) —");
assert(looksLikeInboundMediaOnlyEvent("_event_image__"), "event image");
assert(looksLikeInboundMediaOnlyEvent("_event_document__abc"), "event document");
assert(!looksLikeInboundMediaOnlyEvent("M400-130 error gps"), "texto normal no es media-only");

console.log("\n— Cue adjunto imagen —");
const msg =
  "BUENAS TARDES ERROR DE GPS UNIDAD M400-130 ETAPA DE IDA TALCAHUANO Y SAN VICENTE , CUANDO LA UNIDAD PASA POR ETAPA , ADJUNTO IMAGEN";
assert(looksLikeCustomerImageAttachmentCue(msg), "detecta ADJUNTO IMAGEN");
assert(shouldRouteGpsConsultToUnidades(msg), "unidad M400-130 + etapas → telemetría primero");
assert(!looksLikeGpsFeatureIssueForAdvisor(msg), "con unidad NO es advisor-only GPS");
assert(classifyTurnExecutor(msg, "") === "unidades", "classify → unidades (sin aiImage)");

console.log("\n— Copy de aviso (sin visión BBC) —");
assert(/no pude leer|no puedo analizar/i.test(NO_IMAGE_ANALYSIS_REPLY), "reply fija");
assert(
  /no pude leer/i.test(withNoImageAnalysisNotice("Anoté el reclamo.")),
  "notice + body",
);

if (failed > 0) {
  console.error(`\n✗ ${failed} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ Verificación no-análisis de imágenes OK");
