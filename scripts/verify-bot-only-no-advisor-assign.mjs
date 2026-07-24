#!/usr/bin/env node
/**
 * Regresión: certificados y odómetro son trámites bot-only — no auto-asignar al asesor en inbound.
 *
 * Uso: npx tsx scripts/verify-bot-only-no-advisor-assign.mjs
 */
import {
  shouldAutoAssignInboundTicket,
  detectIncidentType,
  BOT_ONLY_INCIDENT_TYPES,
} from "../src/lib/wara.ts";

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

console.log("\n— Detección por texto del cliente —");
assert(
  detectIncidentType("Quiero el certificado de la unidad AF111GG") === "CERTIFICATE_ISSUE",
  "certificado detectado",
);
assert(
  !shouldAutoAssignInboundTicket(
    detectIncidentType("Quiero el certificado de la unidad AF111GG"),
  ),
  "certificado no auto-asigna",
);
assert(
  detectIncidentType("Solicito cambio de odometro") === "ODOMETER_CHANGE",
  "odómetro detectado",
);
assert(
  !shouldAutoAssignInboundTicket(detectIncidentType("Solicito cambio de odometro")),
  "odómetro no auto-asigna",
);

console.log("\n— Casos que SÍ auto-asignan —");
assert(
  shouldAutoAssignInboundTicket(detectIncidentType("no me reporta la AF061DO")),
  "falta de reporte sí auto-asigna (asesor/Odoo)",
);
assert(shouldAutoAssignInboundTicket(detectIncidentType("hablar con un asesor")), "derivación sí auto-asigna");

if (failed > 0) {
  console.error(`\n✗ ${failed} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ Verificación bot-only sin asignación OK");
