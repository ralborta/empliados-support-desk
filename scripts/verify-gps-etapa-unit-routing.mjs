#!/usr/bin/env node
/**
 * GPS etapas + unidad resoluble → unidades (telemetría) antes de asesor.
 * Sin unidad → asesor. Telemetría sana + reclamo UI → GENERAL_TECH en unidades.
 *
 * Uso: npx tsx scripts/verify-gps-etapa-unit-routing.mjs
 */
import {
  extractUnitCandidatesFromVisionText,
  looksLikeGpsPlatformUiSymptomOnly,
  looksLikeResolvableUnitReferenceInMessage,
  shouldRouteGpsConsultToUnidades,
} from "../src/lib/gpsConsultRouting.ts";
import {
  looksLikeGpsFeatureIssueForAdvisor,
  looksLikeExplicitReclamoOrTicketRequest,
} from "../src/lib/waraApi.ts";
import { looksLikePostAdvisorCaseSupplement } from "../src/lib/wara.ts";
import { classifyTurnExecutor } from "../src/lib/whatsappTurnRouter.ts";
import { mergeInboundTextWithAiImage } from "../src/lib/inboundImagePolicy.ts";

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
  "Ya existe un caso abierto. Un asesor de Atención al cliente te va a contactar. ¿Querés sumar algo más al reclamo?";

console.log("— Unidad + etapas → unidades —");
const m400Msg =
  "interno M400-105 no reporta etapa de la vuelta, tampoco revisa cumplimiento";
assert(looksLikeResolvableUnitReferenceInMessage(m400Msg), "M400-105 resoluble");
assert(looksLikeGpsPlatformUiSymptomOnly(m400Msg), "síntoma UI etapas");
assert(shouldRouteGpsConsultToUnidades(m400Msg), "shouldRoute → unidades");
assert(!looksLikeGpsFeatureIssueForAdvisor(m400Msg), "no advisor-only GPS");
assert(classifyTurnExecutor(m400Msg, "") === "unidades", "router → unidades");
assert(
  !looksLikePostAdvisorCaseSupplement(m400Msg, advisorThread),
  "no supplement odoo con unidad resoluble",
);

console.log("\n— Sin unidad → asesor —");
const bareEtapas = "NO REPORTA ETAPAS DE LA VUELTA.";
assert(!looksLikeResolvableUnitReferenceInMessage(bareEtapas), "sin unidad");
assert(looksLikeGpsFeatureIssueForAdvisor(bareEtapas), "advisor GPS etapas");
assert(classifyTurnExecutor(bareEtapas, "") === "odoo_ticket", "router → odoo_ticket");
assert(
  looksLikePostAdvisorCaseSupplement(bareEtapas, advisorThread),
  "supplement sin unidad en hilo asesor",
);

console.log("\n— Patente + etapas → unidades —");
const plateMsg = "NKL 961 no reporta etapas de la vuelta";
assert(shouldRouteGpsConsultToUnidades(plateMsg), "patente + etapas → unidades");
assert(classifyTurnExecutor(plateMsg, "") === "unidades", "router patente → unidades");

console.log("\n— Visión imagen con candidato —");
const vision =
  "Tabla cumplimiento etapas unidad M400-105 mapa recorrido sin etapa Talcahuano.";
const merged = mergeInboundTextWithAiImage("_event_image__", vision);
assert(extractUnitCandidatesFromVisionText(merged).includes("M400-105"), "candidato visión");
assert(shouldRouteGpsConsultToUnidades(merged), "merged visión → unidades");
assert(classifyTurnExecutor(merged, "") === "unidades", "router visión → unidades");

console.log("\n— Telemetría sana + UI (detección) —");
const uiOnly = "M400-105 historial de recorrido no muestra las etapas";
assert(looksLikeGpsPlatformUiSymptomOnly(uiOnly), "UI symptom only");
assert(shouldRouteGpsConsultToUnidades(uiOnly), "unidad + UI → unidades primero");

if (failed > 0) {
  console.error(`\n✗ ${failed} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ GPS etapa unit routing OK");
