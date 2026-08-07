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

assert.equal(
  classifyTurnExecutor("la pantalla del gps anda mal el tactil", ""),
  "odoo_ticket",
  "pantalla táctil sin verbo reclamar",
);

// Sigue en alcance Atilio (no robar GPS / odómetro).
assert.equal(
  looksLikeOutOfScopeSupportClaim("la unidad AD356UQ no reporta"),
  false,
  "GPS no es out-of-scope",
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
