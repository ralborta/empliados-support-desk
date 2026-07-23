#!/usr/bin/env node
/**
 * Verificación general pre-pruebas manuales: routing, derivación y lógica GPS.
 * Uso: npx tsx scripts/verify-system-health.mjs
 */
import { classifyTurnExecutor } from "../src/lib/whatsappTurnRouter.ts";
import {
  certificateFlowState,
  extractPlateCorrectionHint,
  hasPendingCertificateConfirmation,
  hasPendingMaintenancePlateRequest,
  hasPendingMantenimientoConfirmation,
  looksLikeBriefConfirmation,
  threadTextSinceCompanySelection,
} from "../src/lib/wara.ts";
import {
  looksLikeChangeCompanyRequest,
  looksLikeOpcionesInfoRequest,
  looksLikeCompanySelection,
  looksLikeHumanAdvisorRequest,
  looksLikeAtilioHelpRequest,
  looksLikeNonOdometerOperationalIntent,
  looksLikeOperationalMaintenanceIntent,
  looksLikeMaintenanceExplorationRequest,
  looksLikeMaintenanceInfoRequest,
  looksLikeMaintenanceCapabilityQuestion,
  formatCompanyConfirmMessage,
} from "../src/lib/waraApi.ts";
import { looksLikeOpenCaseStatusInquiry } from "../src/lib/customerTicketInquiry.ts";
import { looksLikeCustomerConversationCloseRequest } from "../src/lib/customerConversationClose.ts";
import { assessUnitReporting } from "../src/lib/waraGpsAssessment.ts";
import {
  extractPlatePrefixFromMessage,
  isBarePlatePrefixHint,
  looksLikeOdometerHelpRequest,
} from "../src/lib/wara.ts";
import { resolveUnitQuery, isMaintenancePlateSelectionMessage } from "../src/lib/waraUnitIntent.ts";

let failed = 0;

function assert(cond, label) {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${label}`);
  }
}

function route(text, thread = "") {
  const scoped = thread ? threadTextSinceCompanySelection(thread) : "";
  const classificationThread = scoped.trim() ? `${scoped}\n${text}`.trim() : text;
  return classifyTurnExecutor(text, classificationThread);
}

const certAwaitUnit = "Para el certificado de cobertura necesito la unidad: decime la patente";
const certAwaitConfirm = [
  "Voy a generar el certificado de cobertura para la patente AE 483 VE.",
  "Empresa: WARA",
  "Si está correcto, responde CONFIRMO.",
].join("\n");
const certDone = [
  "Generé el certificado de cobertura para AE 483 VE.",
  "http://staging.visionblo.com/certificado/xyz",
].join("\n");
const odoPending = [
  "Voy a registrar:",
  "Patente: LWK 7902",
  "Odómetro: 125000 km",
  "Si está correcto, responde CONFIRMO.",
].join("\n");

console.log("— Routing operativo —");
const routing = [
  ["necesito un certificado", "", "certificados"],
  ["NKL", certAwaitUnit, "certificados"],
  ["CONFIRMO", certAwaitConfirm, "certificados"],
  ["como esta la ignicion de AE 483 VE", certDone, "unidades"],
  ["configuracion de la aenda", certDone, "info_guides"],
  ["puedo ver los usuarios de mi empresa", certDone, "info_guides"],
  ["como esta la ignicion de AE 483 VE", "", "unidades"],
  ["listame mis unidades", "", "unidades"],
  ["quiero cambiar el odometro de LWK 7902", "", "odometro"],
  ["me ayudas con la agenda", odoPending, "info_guides"],
  // Bug real (producción, 2026-07-22): "configuraciones" (plural) no matcheaba el
  // regex de \bconfiguracion\b y el mensaje caía en el default "unidades", pidiendo
  // una patente para una pregunta genérica de ayuda con configuraciones.
  ["ok otra cosa me ayudas con las configuraciones?", "", "info_guides"],
  // Bug real (producción, 2026-07-23): "confuguracion" (typo, swap i/u) no matcheaba el
  // literal "configuracion\w*" y caía en el default "unidades", pidiendo matrícula para
  // una pregunta genérica de ayuda con la configuración.
  ["me ayudas con la confuguracion?", "", "info_guides"],
  // Bug real (producción, 2026-07-23): "usuario"/"plataforma" sueltos disparaban
  // detectIncidentType=ACCESS_PLATFORM y el mensaje se derivaba a ticket humano en vez de
  // contestar sobre Perfiles — el bare-word matching no distinguía intención informativa
  // de un problema real de acceso.
  ["que tipos de usuarios hay", "", "info_guides"],
  ["cuantos tipos de usuario hay en wara", "", "info_guides"],
  ["no puedo entrar con mi usuario, dice contraseña incorrecta", "", "odoo_ticket"],
  ["me podes ayudar con una configuracion?", "", "info_guides"],
  // Bug real (producción, 2026-07-23): "ayuden" (3ra persona plural) no matcheaba la
  // lista cerrada de conjugaciones ("me ayudas", "ayudame", "ayudarme", "podés ayudar")
  // y caía en el default "unidades", pidiendo matrícula. Se generalizó a la raíz "ayud".
  ["quiero q me ayuden con la configuracion", "", "info_guides"],
  ["quiero programar mantenimiento preventivo", "", "mantenimiento"],
  ["Quiero programar un mantenimiento", "", "mantenimiento"],
  ["como funciona el modulo de mantenimiento", "", "info_guides"],
  ["Quiero saber sobre mantenimiento", "", "info_guides"],
];
for (const [text, thread, expect] of routing) {
  assert(route(text, thread) === expect, `routing "${text}" → ${expect}`);
}

console.log("— Post-empresa / mantenimiento (no mudo) —");
assert(
  looksLikeOperationalMaintenanceIntent("Quiero programar un mantenimiento"),
  "operational maintenance intent",
);
assert(
  !looksLikeOperationalMaintenanceIntent("Quiero saber sobre mantenimiento"),
  "saber sobre mantenimiento NO es operativo",
);
assert(
  looksLikeMaintenanceExplorationRequest("Quiero saber sobre mantenimiento"),
  "saber sobre mantenimiento es exploración",
);
assert(
  looksLikeMaintenanceInfoRequest("Quiero saber sobre mantenimiento"),
  "saber sobre mantenimiento es info",
);
assert(
  looksLikeNonOdometerOperationalIntent("Quiero programar un mantenimiento"),
  "non-odometer operational after company pick",
);
assert(
  formatCompanyConfirmMessage("El Cacique S.A.") ===
    "Perfecto, sigo con El Cacique S.A. ¿En qué te puedo ayudar?",
  "company confirm without double period",
);

const maintGuideThread = [
  "El modulo de mantenimiento sirve para gestionar tareas preventivas y correctivas.",
  "Queres que te explique como crear un plan o una tarea?",
].join("\n");
const capabilityQ = "Vos podes generar un mantenimiento o lo hago yo?";
const scheduleWithBotQ = "Puedo programar uno con vos?";
assert(
  looksLikeMaintenanceCapabilityQuestion(scheduleWithBotQ, maintGuideThread),
  "programar uno con vos tras guía",
);
assert(
  route(scheduleWithBotQ, maintGuideThread) === "mantenimiento",
  "programar con vos → mantenimiento (no mute)",
);
assert(
  looksLikeMaintenanceCapabilityQuestion(capabilityQ),
  "capability question after maint guide",
);

const maintPlateThread = [
  "Sí, yo puedo registrar o programar un mantenimiento por acá en WhatsApp.",
  "Decime la patente de la unidad y si es preventivo o correctivo (y un detalle breve si querés).",
].join("\n");
assert(hasPendingMaintenancePlateRequest(maintPlateThread), "capability reply detecta pedido de patente");
assert(route("AD", maintPlateThread) === "mantenimiento", "AD tras pedido patente → mantenimiento");
assert(
  route("La q comienza con AD", maintPlateThread) === "mantenimiento",
  "prefijo AD tras pedido patente → mantenimiento",
);
assert(isMaintenancePlateSelectionMessage("AD"), "AD es selección de patente");
assert(
  !isMaintenancePlateSelectionMessage("Quiero hacer un mantenimiento"),
  "inicio trámite NO es selección de patente",
);
assert(
  route("Quiero hacer un mantenimiento", maintPlateThread) === "mantenimiento",
  "quiero hacer mantenimiento → mantenimiento",
);

const longMaintThread = [
  ...Array(8).fill("mensaje previo del hilo"),
  "Voy a registrar:",
  "Patente: AD427MC",
  "Tipo: Plan de mantenimiento",
  "Prioridad: normal",
  "Detalle: Mantenimiento preventivo para AD 427 MC",
  "Si esta correcto, responde CONFIRMO para registrarlo.",
].join("\n");
assert(hasPendingMantenimientoConfirmation(longMaintThread), "confirm pendiente hilo largo");
assert(route("Confirmo", longMaintThread) === "mantenimiento", "Confirmo → mantenimiento");

const maintConfirmThread = [
  "Voy a registrar:",
  "Patente: AD427MC",
  "Tipo: Plan de mantenimiento",
  "Prioridad: normal",
  "Detalle: Mantenimiento preventivo para AD 427 MC",
  "Si esta correcto, responde CONFIRMO para registrarlo.",
].join("\n");
assert(hasPendingMantenimientoConfirmation(maintConfirmThread), "resumen mantenimiento pendiente");
assert(route("Confirmo", maintConfirmThread) === "mantenimiento", "Confirmo resumen mantenimiento");
assert(
  route("Como puedo saber si esta marcado bien el GPS?", maintConfirmThread) === "unidades",
  "GPS tras mantenimiento NO reusa trámite",
);
assert(
  route("Como puedo saber si esta marcado bien el GPS?", maintConfirmThread + "\nHola Raúl, seguimos por acá.") ===
    "unidades",
  "GPS tras hola + mantenimiento pendiente → unidades",
);

console.log("— Derivación (asesor / casos / NO derivar de más) —");
const derivation = [
  ["hablar con un asesor", "odoo_ticket"],
  ["quiero hablar con una persona", "odoo_ticket"],
  ["escalar a un operador por favor", "odoo_ticket"],
  ["derivar con un asesor", "odoo_ticket"],
  ["tengo un caso abierto?", "odoo_ticket"],
  ["cerrar caso", "odoo_ticket"],
  ["falla de ignicion en LWK 7902", "unidades"],
  ["la unidad no reporta AE 483 VE", "unidades"],
  ["tengo un problema con el gps", "unidades"],
  ["ultimo reporte NKL 961", "unidades"],
  ["quiero hacer un reclamo", "odoo_ticket"],
  ["necesito abrir un ticket", "odoo_ticket"],
  ["problema con la factura", "odoo_ticket"],
  ["no puedo entrar a la plataforma", "odoo_ticket"],
  ["asesor", "odoo_ticket"],
  ["configuracion de la aenda", "info_guides"],
];
for (const [text, expect] of derivation) {
  assert(route(text) === expect, `derivación "${text}" → ${expect}`);
}

const advisorThread = [
  "Listo, generé el caso N° 12345 y un asesor de Atención al cliente lo va a revisar.",
  "¿Querés sumar algo más al reclamo?",
].join("\n");
assert(route("confirmo", advisorThread) === "unidades", "confirmo post-asesor NO re-deriva");
assert(route("dale", advisorThread) === "unidades", "dale post-asesor NO re-deriva");
assert(route("gracias", advisorThread) === "unidades", "gracias post-asesor NO re-deriva");

assert(looksLikeHumanAdvisorRequest("escalar a un operador por favor"), "detecta escalar+operador");
assert(looksLikeHumanAdvisorRequest("hablar con un asesor"), "detecta hablar con asesor");
assert(!looksLikeHumanAdvisorRequest("como esta la ignicion"), "ignición NO es asesor");
assert(!looksLikeHumanAdvisorRequest("tengo un caso abierto?"), "caso abierto NO es pedido asesor");
assert(looksLikeOpenCaseStatusInquiry("tengo un caso abierto?"), "detecta caso abierto");
assert(looksLikeCustomerConversationCloseRequest("cerrar caso"), "detecta cerrar caso");
assert(looksLikeAtilioHelpRequest("me podes ayudar vos?"), "detecta ayuda Atilio");
assert(!looksLikeAtilioHelpRequest("hablar con un asesor"), "asesor ≠ ayuda Atilio");
// Bug real (producción, 2026-07-23): "me podes ayudar con una configuracion?" quedaba
// atrapado en esta capa genérica (menú fijo de capacidades, sin base de conocimiento) en
// vez de llegar al router y responder con la guía real de Opciones.
assert(
  !looksLikeAtilioHelpRequest("me podes ayudar con una configuracion?"),
  "pedido de ayuda CON tema puntual no lo atrapa el menú genérico de capacidades",
);
assert(
  !looksLikeAtilioHelpRequest("me podes ayudar con la agenda?"),
  "pedido de ayuda con agenda tampoco lo atrapa el menú genérico",
);
// Auditoría 2026-07-23: mismo patrón de bug (lista cerrada de conjugaciones de "ayudar")
// encontrado también en looksLikeAtilioHelpRequest y looksLikeOdometerHelpRequest —
// generalizados a la raíz "ayud" igual que looksLikeOpcionesInfoRequest.
assert(looksLikeAtilioHelpRequest("vos no me ayudan nunca?"), "detecta 'ayudan' (plural) dirigido al bot");
assert(looksLikeAtilioHelpRequest("pueden ayudarme?"), "detecta 'pueden ayudarme' (plural)");
assert(
  looksLikeOdometerHelpRequest("me ayudan con el odometro?"),
  "ayuda de odómetro detecta 'ayudan' (plural)",
);

for (const t of [
  "puedo ver los usuarios de mi empresa",
  "configuracion de la aenda",
  "como esta la ignicion de AE 483 VE",
  "cambiar patente LWK",
]) {
  assert(!looksLikeChangeCompanyRequest(t), `NO cambiar empresa: "${t}"`);
}

assert(certificateFlowState(certAwaitUnit) === "awaiting_unit", "estado cert unidad");
assert(hasPendingCertificateConfirmation(certAwaitConfirm), "cert pendiente confirm");
assert(certificateFlowState(certDone) === "none", "cert cerrado");
assert(!extractPlateCorrectionHint("configuracion de la aenda"), "aenda no es patente");

console.log("— Prefijo de patente post-listado —");
assert(isBarePlatePrefixHint("La AD"), "La AD es prefijo");
assert(extractPlatePrefixFromMessage("La q comienza con AD") === "AD", "comienza con AD");
const fleetUnits = [
  { movil_id: 1, patente: "AD 427 MC", unidad: "CAMION 1" },
  { movil_id: 2, patente: "AD 999 XX", unidad: "CAMION 2" },
];
const listThread = "Tenés 414 unidades. Algunas: OST 223, AD 427 MC.";
const laAd = await resolveUnitQuery({
  rawText: "La AD",
  threadText: listThread,
  units: fleetUnits,
});
assert(laAd.intent === "need_clarification", "La AD → aclaración con opciones AD");
assert((laAd.clarificationQuestion ?? "").includes("AD 427 MC"), "La AD lista candidatos");

const laXx = await resolveUnitQuery({
  rawText: "La XX",
  threadText: listThread,
  units: fleetUnits,
});
assert(laXx.intent === "need_clarification", "La XX → no está en flota");
assert((laXx.clarificationQuestion ?? "").includes("XX"), "La XX menciona prefijo XX");

const fakePlate = await resolveUnitQuery({
  rawText: "NKL 000",
  threadText: "",
  units: fleetUnits,
});
assert(fakePlate.intent === "need_clarification", "patente inexistente → aclaración");
assert((fakePlate.clarificationQuestion ?? "").includes("no está en la flota"), "patente inexistente explícita");

console.log("— Marca Nissan en certificado —");
const certAwaitUnitThread =
  "Para el certificado de cobertura necesito la unidad: decime la patente (ej. AD 427 MC), el nombre o la marca (ej. Saveiro, Nissan) o un prefijo (ej. HEJ).";
const fleetWithOneNissan = [
  { movil_id: 1, patente: "OST 223", unidad: "900-041" },
  { movil_id: 2, patente: "AD 427 MC", unidad: "CAMION 1" },
  { movil_id: 3, patente: "AH 562 SP", unidad: "NISSAN FRONTIER" },
];
const nissanCert = await resolveUnitQuery({
  rawText: "Nissan",
  threadText: certAwaitUnitThread,
  units: fleetWithOneNissan,
  preferAi: true,
  certificateContext: true,
});
assert(
  nissanCert.intent === "consult_status" && nissanCert.plate === "AH562SP",
  "una Nissan en flota → patente directa (sin OST/AD)",
);
const paraLaNissan = await resolveUnitQuery({
  rawText: "Para la Nissan",
  threadText: `${certAwaitUnitThread}\n¿Podés confirmar la patente? Opciones: OST 223, AD 427 MC.`,
  units: fleetWithOneNissan,
  preferAi: true,
  certificateContext: true,
});
assert(
  paraLaNissan.intent === "consult_status" && paraLaNissan.plate === "AH562SP",
  "Para la Nissan → misma unidad única",
);

console.log("— GPS / ignición (lógica de ticket automático) —");
const unit = (reportSec, posSec, ignSec, ignOn) => ({
  patente: "TEST",
  ultimo_reporte: { hace_segundos: reportSec },
  ultima_posicion: posSec != null ? { hace_segundos: posSec } : undefined,
  ultima_ignicion:
    ignSec != null ? { hace_segundos: ignSec, estado: ignOn } : undefined,
});

const gps = [
  [unit(300, 400, 450, true), "ok"],
  [unit(5000, 5100, 5200, false), "coherent_pause"],
  [unit(7200, 15000, 7200, false), "missing_report"],
  [unit(400, 400, 8000, false), "ignition_failure"],
  [unit(400, 9000, 400, false), "stale_position"],
];
for (const [u, expect] of gps) {
  const a = assessUnitReporting(u);
  assert(a?.status === expect, `GPS esperaba ${expect}, got ${a?.status ?? "null"}`);
}

if (failed > 0) {
  console.error(`\n✗ ${failed} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ Verificación general OK (routing + derivación + GPS + guards)");
