#!/usr/bin/env node
/**
 * Fuera de alcance → mensaje natural + handoff panel Wara (sin Odoo).
 */
import assert from "node:assert/strict";
import {
  looksLikeOutOfScopeSupportClaim,
} from "../src/lib/waraApi.ts";
import {
  pickOutOfScopeHandoffReply,
} from "../src/lib/advisorHandoff.ts";

assert.equal(
  looksLikeOutOfScopeSupportClaim("la pantalla táctil del equipo está rota"),
  true,
);
assert.equal(
  looksLikeOutOfScopeSupportClaim("necesito reclamar la factura del mes"),
  true,
);
assert.equal(
  looksLikeOutOfScopeSupportClaim("M400-105 NO REPORTA ETAPA AV MOLINA (VUELTA)"),
  false,
  "etapas con unidad no es fuera de alcance genérico",
);
assert.equal(
  looksLikeOutOfScopeSupportClaim("estado gps de AG382QB"),
  false,
);

const reply = pickOutOfScopeHandoffReply("5492612732306");
assert.match(reply, /no (te )?puedo ayudar|no lo puedo resolver|fuera de lo que puedo/i);
assert.match(reply, /asistente|operador|transfiero|derivo|paso/i);
assert.match(reply, /caso|consulta|resolver|ayud/i);
assert.doesNotMatch(reply, /odoo|#\d{4,}|unidad no encontrada|coincida con/i);

console.log("OK verify-out-of-scope-platform-handoff");
