#!/usr/bin/env node
/**
 * Regresión integral del cerebro de routing (no solo classifyTurnExecutor aislado).
 * Simula el hilo que ve /api/whatsapp/turn: scoped + mensaje actual.
 *
 * Uso: npx tsx scripts/verify-turn-pipeline.mjs
 */
import { classifyTurnExecutor } from "../src/lib/whatsappTurnRouter.ts";
import { resolvePendingConfirmationExecutor } from "../src/lib/pendingConfirmation.ts";
import { loadTurnThreadContext } from "../src/lib/conversationThread.ts";
import {
  hasPendingMantenimientoConfirmation,
  isOdometerFlowSuperseded,
  threadTextSinceCompanySelection,
} from "../src/lib/wara.ts";
import {
  looksLikeGpsOrUnitStatusQuestion,
  looksLikeHumanAdvisorRequest,
  shouldContinueOdometerFlow,
} from "../src/lib/waraApi.ts";

let failed = 0;

function assert(cond, label) {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${label}`);
  }
}

/** Como /turn: hilo scoped + mensaje actual para clasificar. */
function turnRoute(text, fullThread = "") {
  const scoped = threadTextSinceCompanySelection(fullThread);
  const classificationThread = scoped.trim()
    ? `${scoped}\n${text}`.trim()
    : text;
  return classifyTurnExecutor(text, classificationThread);
}

const maintSummary = [
  "Voy a registrar:",
  "Patente: AD427MC",
  "Tipo: Plan de mantenimiento",
  "Prioridad: normal",
  "Detalle: Mantenimiento preventivo para AD 427 MC",
  "Si esta correcto, responde CONFIRMO para registrarlo.",
].join("\n");

const odoSummary = [
  "Voy a registrar:",
  "Patente: LWK 7902",
  "Odómetro: 125000 km",
  "Si está correcto, respondé CONFIRMO para registrarlo.",
].join("\n");

const certSummary = [
  "Voy a generar el certificado de cobertura:",
  "Patente: AE 483 VE",
  "Empresa: WARA",
  "Si esta correcto, responde CONFIRMO para solicitarlo a Wara.",
].join("\n");

console.log("— Confirmaciones (prioridad cert > odo > maint) —");
assert(
  resolvePendingConfirmationExecutor(certSummary, "Confirmo") === "certificados",
  "confirm cert",
);
assert(
  resolvePendingConfirmationExecutor(odoSummary, "confirmo") === "odometro",
  "confirm odo",
);
assert(
  resolvePendingConfirmationExecutor(maintSummary, "Confirmo") === "mantenimiento",
  "confirm maint",
);
assert(turnRoute("Confirmo", maintSummary) === "mantenimiento", "turn Confirmo maint");

console.log("— Cambio de tema tras mantenimiento pendiente —");
assert(
  turnRoute("Como puedo saber si esta marcado bien el GPS?", maintSummary) === "unidades",
  "GPS no secuestra maint",
);
assert(
  looksLikeGpsOrUnitStatusQuestion("Como puedo saber si esta marcado bien el GPS?"),
  "detecta pregunta GPS",
);

console.log("— Derivación —");
assert(turnRoute("hablar con un asesor") === "odoo_ticket", "asesor");
assert(turnRoute("quiero hacer un reclamo") === "odoo_ticket", "reclamo");
assert(turnRoute("tengo un problema con el gps") === "unidades", "gps operativo");
assert(!looksLikeHumanAdvisorRequest("tengo un caso abierto?"), "caso abierto ≠ asesor");
assert(turnRoute("tengo un caso abierto?") === "odoo_ticket", "caso abierto");

console.log("— Cross-tenant (scoped thread) —");
const crossTenant = [
  "Perfecto, sigo con El Cacique S.A. ¿En qué te puedo ayudar?",
  "Quiero programar mantenimiento preventivo",
  maintSummary,
].join("\n");
assert(hasPendingMantenimientoConfirmation(threadTextSinceCompanySelection(crossTenant)), "maint post-empresa");
assert(turnRoute("Confirmo", crossTenant) === "mantenimiento", "Confirmo post cambio empresa");

console.log("— Hilo contaminado (mantenimiento viejo + GPS/ignición) —");
const pollutedMaintThread = [
  "Para registrar el mantenimiento necesito la patente de la unidad (formato AA123BB o ABC123) junto con un breve detalle y, si querés, la prioridad.",
  "modulo de mantenimiento",
  "orientacion de uso",
  "Puedo guiarte sobre los módulos Opciones, Unidades o Mantenimiento de Wara.",
  "No pude reconocer una patente completa. Enviamela con formato AA123BB or ABC123 junto con el detalle y la prioridad.",
].join("\n");
assert(
  turnRoute("No sé si mi GPS está marcando bien", pollutedMaintThread) === "unidades",
  "GPS no va a info_guides con hilo maint",
);
assert(
  turnRoute("quiero ver la ignicio de mi unidad", pollutedMaintThread) === "unidades",
  "ignición no va a mantenimiento con hilo maint",
);
assert(
  turnRoute("Nissan", `${pollutedMaintThread}\nquiero ver la ignicio de mi unidad`) === "unidades",
  "marca tras consulta ignición va a unidades",
);
assert(
  turnRoute("Mi odometro no marca bien", pollutedMaintThread) === "odoo_ticket",
  "falla odómetro → soporte, no guías",
);
assert(
  turnRoute("Tengo problemas con el odometro", pollutedMaintThread) === "odoo_ticket",
  "problemas odómetro → odoo_ticket",
);
assert(
  !isOdometerFlowSuperseded([
    "Voy a registrar:",
    "Patente: AD 427 MC",
    "Odómetro: 5567 km",
    "Si está correcto, respondé CONFIRMO para registrarlo en Wara.",
    "Si",
    "Listo, registré el cambio para la unidad AD427MC. Odómetro nuevo: 5567 km.",
    "Ok quiero un registro",
    "Puedo guiarte sobre los módulos Opciones, Unidades o Mantenimiento de Wara.",
  ].join("\n")),
  "odómetro registrado no supersede futuras consultas",
);

console.log("— Flujo odómetro (patente, corrección, unidad) —");
const odoThread = [
  "Me ayudas con mi odometro?",
  "Perfecto, tomo AD 427 MC. ¿Cuál es el nuevo odómetro en km?",
].join("\n");
assert(turnRoute("Me ayudas con mi odometro?", "") === "odometro", "ayuda odómetro → odometro");
assert(
  turnRoute("No es otra patente", odoThread) === "odometro",
  "corrección patente → odometro",
);
assert(
  turnRoute("La patente de Saveiro", `${odoThread}\nNo es otra patente`) === "odometro",
  "marca en flujo odómetro → odometro",
);
assert(
  shouldContinueOdometerFlow("No es otra patente", odoThread),
  "corrección patente continúa flujo odómetro",
);

console.log("— Operativo base —");
assert(turnRoute("listame mis unidades") === "unidades", "flota");
assert(turnRoute("como funciona el modulo de mantenimiento") === "info_guides", "guía maint");
assert(turnRoute("ultimo reporte NKL 961") === "unidades", "reporte");

console.log("— TurnThreadContext (API) —");
const ctx = await loadTurnThreadContext("+5490000000000", "hola");
assert(typeof ctx.fullThread === "string", "loadTurnThreadContext full");
assert(typeof ctx.scopedThread === "string", "loadTurnThreadContext scoped");
assert(typeof ctx.classificationThread === "string", "loadTurnThreadContext classification");

if (failed > 0) {
  console.error(`\n✗ ${failed} fallo(s) en pipeline`);
  process.exit(1);
}
console.log(`\n✓ Pipeline routing OK (${failed === 0 ? "todas las categorías" : ""})`);
