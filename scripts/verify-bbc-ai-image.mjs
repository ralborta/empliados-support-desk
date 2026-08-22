#!/usr/bin/env node
/**
 * BBC interpretImage → {aiImage} se fusiona al texto del turno.
 * Sin aiImage usable, se mantiene el pedido de detalle por escrito.
 *
 * Uso: npx tsx scripts/verify-bbc-ai-image.mjs
 */
import {
  AI_IMAGE_CONTEXT_PREFIX,
  hasUsableAiImageDescription,
  looksLikeCustomerImageAttachmentCue,
  looksLikeInboundMediaOnlyEvent,
  mergeInboundTextWithAiImage,
  NO_IMAGE_ANALYSIS_REPLY,
  selectionHasAiImageContext,
  withNoImageAnalysisNotice,
} from "../src/lib/inboundImagePolicy.ts";
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

const vision =
  "Pantalla GPS unidad M400-130 muestra error en etapa de ida Talcahuano y San Vicente.";

console.log("— aiImage usable —");
assert(hasUsableAiImageDescription(vision), "descripción válida");
assert(!hasUsableAiImageDescription(""), "vacío no vale");
assert(!hasUsableAiImageDescription("{aiImage}"), "placeholder no vale");
assert(!hasUsableAiImageDescription("corto"), "muy corta no vale");

console.log("\n— Merge media-only + aiImage —");
const mergedOnly = mergeInboundTextWithAiImage("_event_image__", vision);
assert(selectionHasAiImageContext(mergedOnly), "prefijo en merge");
assert(mergedOnly.includes("M400-130"), "incluye unidad de la visión");
assert(!looksLikeInboundMediaOnlyEvent(mergedOnly), "ya no es media-only");
assert(
  classifyTurnExecutor(mergedOnly, "") === "unidades" ||
    shouldRouteGpsConsultToUnidades(mergedOnly),
  "visión con unidad → unidades",
);

console.log("\n— Merge caption + aiImage —");
const caption =
  "BUENAS TARDES ERROR DE GPS UNIDAD M400-130 ETAPA DE IDA , ADJUNTO IMAGEN";
const mergedCap = mergeInboundTextWithAiImage(caption, vision);
assert(looksLikeCustomerImageAttachmentCue(mergedCap), "sigue detectando adjunto");
assert(mergedCap.includes(AI_IMAGE_CONTEXT_PREFIX), "suma descripción");
assert(
  classifyTurnExecutor(mergedCap, "") === "unidades" ||
    shouldRouteGpsConsultToUnidades(mergedCap),
  "caption+visión con unidad → unidades (telemetría primero)",
);

console.log("\n— Sin aiImage: fallback escrito —");
assert(mergeInboundTextWithAiImage("_event_image__", "") === "_event_image__", "sin merge");
assert(looksLikeInboundMediaOnlyEvent("_event_image__"), "media-only sin visión");
assert(/unidad|texto|asesor/i.test(NO_IMAGE_ANALYSIS_REPLY), "copy fallback");
assert(
  withNoImageAnalysisNotice("Anoté el reclamo.").includes("No pude leer"),
  "notice fallback",
);

if (failed > 0) {
  console.error(`\n✗ ${failed} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ Verificación BBC aiImage OK");
