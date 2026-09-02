#!/usr/bin/env node
/**
 * Bug real 2026-08-07: "NECESITO RECLAMAR UNA PANTALLA QUE FUNCIONA MAL EL TACTIL"
 * caía a unidades / pedía # de caso en vez de derivar y asignar asesor.
 *
 * Regla: soporte fuera del alcance de Atilio → odoo_ticket + auto-asignar.
 *
 * Uso: npx tsx scripts/verify-out-of-scope-support-advisor.mjs
 */
import assert from "node:assert/strict";
import { classifyTurnExecutor } from "../src/lib/whatsappTurnRouter.ts";
import { detectIncidentType } from "../src/lib/wara.ts";
import {
  looksLikeExplicitReclamoOrTicketRequest,
  looksLikeOutOfScopeSupportClaim,
  looksLikeTechnicalSupportRequest,
  shouldAutoAssignInboundMessage,
} from "../src/lib/waraApi.ts";

const pantalla =
  "NECESITO RECLAMAR UNA PANTALLA QUE FUNCIONA MAL EL TACTIL";

assert.equal(looksLikeOutOfScopeSupportClaim(pantalla), true, "out of scope: pantalla");
assert.equal(looksLikeExplicitReclamoOrTicketRequest(pantalla), true, "reclamar explícito");
assert.equal(looksLikeTechnicalSupportRequest(pantalla), true, "tech support");
assert.equal(classifyTurnExecutor(pantalla, ""), "odoo_ticket", "router → odoo_ticket");
assert.equal(
  shouldAutoAssignInboundMessage(detectIncidentType(pantalla), pantalla),
  true,
  "auto-asignar asesor",
);

const pantallaNoLeFunciona = "NO LE FUNCIONA LA PANTALLA A ESA UNIDAD";
assert.equal(
  looksLikeOutOfScopeSupportClaim(pantallaNoLeFunciona),
  true,
  "out of scope: no le funciona la pantalla",
);
assert.equal(
  classifyTurnExecutor(pantallaNoLeFunciona, ""),
  "odoo_ticket",
  "no le funciona pantalla → odoo_ticket (no unidades)",
);
assert.equal(
  detectIncidentType(pantallaNoLeFunciona),
  "GENERAL_TECH",
  "incidente GENERAL_TECH",
);

assert.equal(
  classifyTurnExecutor("la pantalla del gps anda mal el tactil", ""),
  "odoo_ticket",
  "pantalla táctil sin verbo reclamar",
);

const webIssue =
  "OLA , ESTA FALLA LA WEB , LAS UNIDADES ESTAN QUIETAS";

assert.equal(looksLikeOutOfScopeSupportClaim(webIssue), true, "out of scope: falla general web/plataforma");
assert.equal(looksLikeTechnicalSupportRequest(webIssue), true, "tech support web");
assert.equal(classifyTurnExecutor(webIssue, ""), "odoo_ticket", "web con unidades quietas → odoo_ticket");
assert.equal(
  shouldAutoAssignInboundMessage(detectIncidentType(webIssue), webIssue),
  true,
  "auto-asignar asesor por falla general web",
);

// Bug real 2026-09-02: flota completa quieta/sin reporte → asesor (no pedir patente).
for (const fleetWide of [
  "Ninguna anda",
  "Estan tods quietas",
  "Estan todas quietas",
  "Ninguna reporta",
  "Esta todas quietas",
  "todas las unidades sin reporte",
]) {
  assert.equal(
    looksLikeOutOfScopeSupportClaim(fleetWide),
    true,
    `out of scope flota: ${fleetWide}`,
  );
  assert.equal(
    classifyTurnExecutor(fleetWide, ""),
    "odoo_ticket",
    `router flota → odoo_ticket: ${fleetWide}`,
  );
  assert.equal(
    shouldAutoAssignInboundMessage(detectIncidentType(fleetWide), fleetWide),
    true,
    `auto-asignar flota: ${fleetWide}`,
  );
}

// Con hilo que ya pedía patente, igual derivar (anti-loop).
assert.equal(
  classifyTurnExecutor(
    "Ninguna reporta",
    "Cliente: ninguna anda\nAtilio: ¿Cuál es la patente de la unidad?\nAtilio: ¿Me podés dar la patente de alguna unidad?",
  ),
  "odoo_ticket",
  "anti-loop: flota masiva gana sobre pedido de patente",
);

// Sigue en alcance Atilio (no robar GPS / odómetro).
assert.equal(
  looksLikeOutOfScopeSupportClaim("la unidad AD356UQ no reporta"),
  false,
  "GPS no es out-of-scope",
);
assert.equal(
  classifyTurnExecutor("la unidad AD356UQ no reporta", ""),
  "unidades",
  "GPS con patente → unidades",
);
assert.equal(
  looksLikeOutOfScopeSupportClaim("la nissan no reporta"),
  false,
  "GPS de una marca no es flota masiva",
);
assert.equal(
  looksLikeOutOfScopeSupportClaim("necesito corregir el odometro"),
  false,
  "odómetro no es out-of-scope",
);
assert.equal(
  classifyTurnExecutor("necesito el certificado de cobertura", ""),
  "certificados",
  "certificado sigue en certificados",
);

console.log("OK — reclamo fuera de alcance → odoo_ticket + auto-asignar");
