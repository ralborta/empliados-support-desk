#!/usr/bin/env node
/**
 * Regresión de fixes críticos para entrega al cliente (jul-2026).
 */
import { classifyTurnExecutor } from "../src/lib/whatsappTurnRouter.ts";
import {
  certificateFlowState,
  hasPendingMaintenancePlateRequest,
  hasPendingUnitConsultPlateRequest,
  isBarePlatePrefixHint,
  looksLikeBriefConfirmation,
  looksLikeExplicitCertificateResendRequest,
  looksLikeHorometerOnlyIntent,
  looksLikeOdometerIntentStart,
  threadHasActiveOdometerFlow,
  threadHasRecentUnitStatusConsultIntent,
  threadTextSinceCompanySelection,
} from "../src/lib/wara.ts";
import { looksLikeGpsOrUnitStatusQuestion } from "../src/lib/waraApi.ts";
import { threadHasRecentFleetUnitSearchRequest } from "../src/lib/waraUnitIntent.ts";
import {
  looksLikeImplicitCompanyChangeAffirmation,
  looksLikeOdometerConfirmationRejection,
} from "../src/lib/waraApi.ts";
import { resolveUnitQuery } from "../src/lib/waraUnitIntent.ts";

let failed = 0;
function assert(cond, label) {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}

console.log("— Unidad 600-117 no matchea patente por substring —");
const fleet = [
  { movil_id: 1, patente: "ESLA600117", unidad: "OTRA" },
  { movil_id: 2, patente: "NKL954", unidad: "M300-112" },
  { movil_id: 3, patente: "NKL955", unidad: "600-117" },
];
const r600 = await resolveUnitQuery({
  rawText: "600-117",
  threadText: "",
  units: fleet,
  preferAi: false,
});
assert(r600.plate === "NKL955", `600-117 → unidad por nombre (obtuvo ${r600.plate})`);

console.log("\n— 'si' no es prefijo de patente —");
assert(looksLikeBriefConfirmation("si"), "si es confirmación breve");
assert(!isBarePlatePrefixHint("si"), "si NO es prefijo de patente");

console.log("\n— Horómetro vs odómetro —");
assert(looksLikeHorometerOnlyIntent("ajustame el horometro de la unidad mencionada"), "detecta solo horómetro");
assert(looksLikeOdometerIntentStart("Quiero realizar un ajuste de horometro"), "ajuste de horometro = arranque");

console.log("\n— Rechazo de confirmación odómetro —");
assert(looksLikeOdometerConfirmationRejection("no es correcto"), "no es correcto = rechazo");
assert(looksLikeOdometerConfirmationRejection("no confirmo quiero otra gestion"), "otra gestión = rechazo");
assert(!looksLikeOdometerConfirmationRejection("confirmo"), "confirmo NO es rechazo");

console.log("\n— Reenvío certificado enruta a certificados —");
const resendMsg = "reenviar el certificado";
assert(looksLikeExplicitCertificateResendRequest(resendMsg), "detecta reenvío explícito");
assert(classifyTurnExecutor(resendMsg, "") === "certificados", "router → certificados");

console.log("\n— Cambio de empresa implícito —");
const threadChange = "No encontré la patente. Revisá o escribí cambiar empresa.";
assert(
  looksLikeImplicitCompanyChangeAffirmation("dale cambialo", threadChange),
  "dale cambialo tras pedido de cambiar empresa",
);

console.log("\n— Reinicio empresa limpia hilo —");
const scoped = threadTextSinceCompanySelection(
  ["No encontré AE 483 VE", "Perfecto, sigo con El Cacique S.A.", "Quiero certificado"].join("\n"),
);
assert(!scoped.includes("AE 483"), "patente vieja fuera del hilo scoped");

console.log("\n— 300-112 no va a odómetro tras buscar unidad —");
const pollutedB = [
  "Para registrar el cambio de horómetro necesito la patente de la unidad.",
  "Perfecto, sigo con El Cacique S.A. ¿En qué te puedo ayudar?",
  "Ayudame a encontrar mi unidad",
  "300-112",
].join("\n");
assert(
  classifyTurnExecutor("300-112", pollutedB) === "unidades",
  "300-112 tras buscar unidad → unidades",
);
assert(threadHasRecentFleetUnitSearchRequest(pollutedB), "detecta pedido de búsqueda");

console.log("\n— 300-112 en certificado gana sobre mantenimiento viejo —");
const certMsg =
  "Para el certificado de cobertura necesito la unidad: decime la patente (ej. AD 427 MC).";
const pollutedC = [
  "Perfecto, sigo con El Cacique S.A. ¿En qué te puedo ayudar?",
  "Quiero mantenimiento preventivo",
  "Para programar mantenimiento preventivo necesito la patente de la unidad",
  "Necesito un certificado de cobertura",
  certMsg,
  "300-112",
].join("\n");
assert(certificateFlowState(pollutedC) === "awaiting_unit", "cert en awaiting_unit");
assert(!hasPendingMaintenancePlateRequest(pollutedC), "mantenimiento no secuestra cert");
assert(
  classifyTurnExecutor("300-112", pollutedC) === "certificados",
  "300-112 en certificado → certificados",
);

console.log("\n— Consulta unidad reciente gana sobre odómetro viejo —");
const pollutedUnitAsk = [
  "Perfecto, tomo AG562SP. ¿Cuál es el nuevo horómetro en horas?",
  "Ayudame a encontrar mi unidad",
  "Por favor, indicame la matrícula exacta de tu unidad.",
  "300-112",
].join("\n");
assert(hasPendingUnitConsultPlateRequest(pollutedUnitAsk), "detecta pedido de matrícula");
assert(
  classifyTurnExecutor("300-112", pollutedUnitAsk) === "unidades",
  "300-112 tras pedido matrícula → unidades",
);

console.log("\n— AF061DO falta de reporte no secuestrada por odómetro —");
const reportThread = [
  "Para registrar el cambio de horómetro necesito la patente de la unidad.",
  "Quiero consultar por el estado de reporte de mis unidades",
  "En El Cacique S.A. tenés 414 unidades registradas.",
  "no me reporta la AF061DO",
].join("\n");
assert(threadHasRecentUnitStatusConsultIntent(reportThread), "detecta consulta de reporte reciente");
assert(!threadHasActiveOdometerFlow(reportThread), "odómetro no activo tras consulta reporte");
assert(looksLikeGpsOrUnitStatusQuestion("no me reporta la AF061DO"), "no me reporta = consulta GPS");
assert(classifyTurnExecutor("no me reporta la AF061DO", reportThread) === "unidades", "AF061DO → unidades");

if (failed > 0) {
  console.error(`\n✗ ${failed} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ Fixes críticos de entrega OK");
