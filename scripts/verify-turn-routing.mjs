#!/usr/bin/env node
/**
 * Regresión de enrutamiento Fase 1 — ejecutar antes de deploy o tras cambios en router/intents.
 * Uso: npx tsx scripts/verify-turn-routing.mjs
 */
import { classifyTurnExecutor } from "../src/lib/whatsappTurnRouter.ts";
import {
  certificateFlowState,
  extractPlateCorrectionHint,
  hasPendingCertificateConfirmation,
} from "../src/lib/wara.ts";
import {
  looksLikeChangeCompanyRequest,
  looksLikeOpcionesInfoRequest,
  looksLikeCompanySelection,
} from "../src/lib/waraApi.ts";

const certAwaitUnitThread =
  "Para el certificado de cobertura necesito la unidad: decime la patente";
const certAwaitConfirmThread = [
  "Voy a generar el certificado de cobertura para la patente AE 483 VE.",
  "Empresa: WARA",
  "Si está correcto, responde CONFIRMO.",
].join("\n");
const certDoneThread = [
  "Generé el certificado de cobertura para AE 483 VE.",
  "http://staging.visionblo.com/rb/app/certificado-monitoreo/xyz",
].join("\n");
const odoAwaitConfirmThread = [
  "Voy a registrar:",
  "Patente: LWK 7902",
  "Odómetro: 125000 km",
  "Si está correcto, responde CONFIRMO.",
].join("\n");

const cases = [
  { name: "cert nuevo", text: "necesito un certificado", thread: "", expect: "certificados" },
  { name: "cert unidad NKL", text: "NKL", thread: certAwaitUnitThread, expect: "certificados" },
  { name: "cert unidad Saveiro", text: "Saveiro", thread: certAwaitUnitThread, expect: "certificados" },
  { name: "cert CONFIRMO", text: "CONFIRMO", thread: certAwaitConfirmThread, expect: "certificados" },
  {
    name: "cert post-done ignicion",
    text: "como esta la ignicion de AE 483 VE?",
    thread: certDoneThread,
    expect: "unidades",
  },
  {
    name: "post-cert agenda typo",
    text: "configuracion de la aenda",
    thread: certDoneThread,
    expect: "info_guides",
    noPlateHint: true,
  },
  {
    name: "post-cert usuarios empresa",
    text: "puedo ver los usuarios de mi empresa",
    thread: certDoneThread,
    expect: "info_guides",
  },
  {
    name: "ignicion con patente",
    text: "como esta la ignicion de AE 483 VE?",
    thread: "",
    expect: "unidades",
  },
  { name: "ultimo reporte", text: "ultimo reporte NKL 961", thread: "", expect: "unidades" },
  { name: "offline", text: "la unidad no reporta LWK 7902", thread: "", expect: "unidades" },
  { name: "listado flota", text: "listame mis unidades", thread: "", expect: "unidades" },
  {
    name: "odo nuevo",
    text: "quiero cambiar el odometro de LWK 7902",
    thread: "",
    expect: "odometro",
  },
  { name: "odo CONFIRMO", text: "confirmo", thread: odoAwaitConfirmThread, expect: "odometro" },
  {
    name: "odo->agenda cambio tema",
    text: "me ayudas con la agenda",
    thread: odoAwaitConfirmThread,
    expect: "info_guides",
  },
  {
    name: "maint operativo",
    text: "quiero programar mantenimiento preventivo",
    thread: "",
    expect: "mantenimiento",
  },
  {
    name: "maint info guia",
    text: "como funciona el modulo de mantenimiento",
    thread: "",
    expect: "info_guides",
  },
  { name: "agenda", text: "agenda", thread: "", expect: "info_guides" },
  { name: "mis atajos", text: "donde esta MIS ATAJOS", thread: "", expect: "info_guides" },
  { name: "asesor", text: "quiero hablar con un asesor", thread: "", expect: "odoo_ticket" },
  { name: "cerrar caso", text: "cerrar caso", thread: "", expect: "odoo_ticket" },
];

let failed = 0;

for (const c of cases) {
  const thread = c.thread ?? "";
  const got = classifyTurnExecutor(c.text, thread);
  if (got !== c.expect) {
    failed++;
    console.error(`FAIL [${c.name}] expected=${c.expect} got=${got} text="${c.text}"`);
  }
  if (c.noPlateHint && extractPlateCorrectionHint(c.text)) {
    failed++;
    console.error(`FAIL [${c.name}] plateHint=${extractPlateCorrectionHint(c.text)}`);
  }
}

if (certificateFlowState(certAwaitUnitThread) !== "awaiting_unit") {
  failed++;
  console.error("FAIL certAwaitUnit state");
}
if (!hasPendingCertificateConfirmation(certAwaitConfirmThread)) {
  failed++;
  console.error("FAIL certAwaitConfirm pending");
}
if (certificateFlowState(certDoneThread) !== "none") {
  failed++;
  console.error("FAIL certDone state should be none");
}

for (const t of [
  "puedo ver los usuarios de mi empresa",
  "configuracion de la aenda",
  "como esta la ignicion de AE 483 VE",
  "Nissan",
  "Saveiro",
  "cambiar patente LWK",
]) {
  if (looksLikeChangeCompanyRequest(t)) {
    failed++;
    console.error(`FAIL changeCompany false positive: "${t}"`);
  }
}

for (const t of ["puedo ver los usuarios de mi empresa", "configuracion de la aenda"]) {
  if (!looksLikeOpcionesInfoRequest(t)) {
    failed++;
    console.error(`FAIL opciones not detected: "${t}"`);
  }
}

if (!looksLikeCompanySelection("1")) {
  failed++;
  console.error("FAIL company selection 1");
}
if (!looksLikeCompanySelection("WARA")) {
  failed++;
  console.error("FAIL company selection WARA");
}
if (looksLikeCompanySelection("como esta la ignicion")) {
  failed++;
  console.error("FAIL company selection ignicion");
}

if (failed > 0) {
  console.error(`\n✗ ${failed} failure(s)`);
  process.exit(1);
}

console.log(`✓ ${cases.length} routing cases + guards OK`);
