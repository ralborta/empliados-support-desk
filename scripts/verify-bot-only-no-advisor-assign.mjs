#!/usr/bin/env node
/**
 * Regresión: Atilio resuelve solo → no auto-asignar al asesor conectado.
 * Solo derivar/asignar ante falta de reporte, acceso/admin, o pedido explícito de humano/reclamo.
 *
 * Regla acordada post-reunión Emma/Lucas 2026-07 (reemplaza "siempre asignar si hay asesor online").
 *
 * Uso: npx tsx scripts/verify-bot-only-no-advisor-assign.mjs
 */
import {
  shouldAutoAssignInboundTicket,
  detectIncidentType,
  BOT_ONLY_INCIDENT_TYPES,
  ADVISOR_ASSIGN_INCIDENT_TYPES,
} from "../src/lib/wara.ts";
import { shouldAutoAssignInboundMessage } from "../src/lib/waraApi.ts";

let failed = 0;
function assert(cond, label) {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}

console.log("— Trámites bot-only NO auto-asignan —");
for (const incident of BOT_ONLY_INCIDENT_TYPES) {
  assert(!shouldAutoAssignInboundTicket(incident), `${incident} → no auto-asignar`);
}

console.log("\n— Lista blanca por incidentType —");
for (const incident of ADVISOR_ASSIGN_INCIDENT_TYPES) {
  assert(shouldAutoAssignInboundTicket(incident), `${incident} → sí auto-asigna`);
}

console.log("\n— Conversaciones que Atilio resuelve solo (sin asesor) —");
assert(
  detectIncidentType("Quiero el certificado de la unidad AF111GG") === "CERTIFICATE_ISSUE",
  "certificado detectado",
);
assert(
  !shouldAutoAssignInboundMessage(
    detectIncidentType("Quiero el certificado de la unidad AF111GG"),
    "Quiero el certificado de la unidad AF111GG",
  ),
  "certificado no auto-asigna",
);
assert(
  detectIncidentType("Solicito cambio de odometro") === "ODOMETER_CHANGE",
  "odómetro detectado",
);
assert(
  !shouldAutoAssignInboundMessage(
    detectIncidentType("Solicito cambio de odometro"),
    "Solicito cambio de odometro",
  ),
  "odómetro no auto-asigna",
);
assert(
  !shouldAutoAssignInboundMessage(detectIncidentType("Buenos dias"), "Buenos dias"),
  "saludo / Otro no auto-asigna (regresión 28072610)",
);
assert(
  !shouldAutoAssignInboundMessage(
    detectIncidentType("quiero hacer un cambio de odometro"),
    "quiero hacer un cambio de odometro",
  ),
  "inicio trámite odómetro no auto-asigna",
);
assert(
  !shouldAutoAssignInboundMessage(
    detectIncidentType("me ayudas a configurar un mantenimiento"),
    "me ayudas a configurar un mantenimiento",
  ),
  "guía de mantenimiento no auto-asigna",
);
assert(
  !shouldAutoAssignInboundMessage(
    detectIncidentType("cual fue su ultimo reporte"),
    "cual fue su ultimo reporte",
  ),
  "consulta GPS informativa (GENERAL_TECH) no auto-asigna por inbound",
);

console.log("\n— Casos que SÍ auto-asignan —");
assert(
  shouldAutoAssignInboundMessage(
    detectIncidentType("no me reporta la AF061DO"),
    "no me reporta la AF061DO",
  ),
  "falta de reporte sí auto-asigna",
);
assert(
  shouldAutoAssignInboundMessage(detectIncidentType("Buenos dias"), "hablar con un asesor"),
  "pedido explícito de asesor sí auto-asigna (aunque incidentType sea Otro)",
);
assert(
  shouldAutoAssignInboundMessage(
    detectIncidentType("no puedo entrar a la plataforma"),
    "no puedo entrar a la plataforma",
  ),
  "acceso/plataforma sí auto-asigna",
);
assert(
  shouldAutoAssignInboundMessage(
    detectIncidentType("tengo un problema de facturacion"),
    "tengo un problema de facturacion",
  ),
  "derivación administrativa sí auto-asigna",
);
assert(
  shouldAutoAssignInboundMessage(
    detectIncidentType("NECESITO RECLAMAR UNA PANTALLA QUE FUNCIONA MAL EL TACTIL"),
    "NECESITO RECLAMAR UNA PANTALLA QUE FUNCIONA MAL EL TACTIL",
  ),
  "reclamo pantalla táctil sí auto-asigna (fuera de alcance Atilio)",
);

if (failed > 0) {
  console.error(`\n✗ ${failed} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ Verificación bot-only / lista blanca de asignación OK");
