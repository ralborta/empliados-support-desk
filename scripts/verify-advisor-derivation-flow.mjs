#!/usr/bin/env node
/**
 * Derivación a asesor humano (V1):
 * - Cliente registrado pide operador → ticket local + mensaje
 * - Número no registrado → ticket local + aviso explícito (sin depender del flow BBC "derivar")
 *
 * Uso: npx tsx scripts/verify-advisor-derivation-flow.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { classifyTurnExecutor } from "../src/lib/whatsappTurnRouter.ts";
import {
  ensureRegisteredAdvisorHandoff,
  REGISTERED_ADVISOR_HANDOFF_REPLY,
  REGISTERED_ADVISOR_HANDOFF_WAITING_REPLY,
} from "../src/lib/advisorHandoff.ts";
import {
  ensureUnregisteredPhoneAdvisorHandoff,
  UNREGISTERED_PHONE_FIRST_HANDOFF_REPLY,
  UNREGISTERED_PHONE_WAITING_ADVISOR_REPLY,
  UNREGISTERED_PHONE_TICKET_TITLE,
} from "../src/lib/unregisteredPhoneHandoff.ts";
import { looksLikeHumanAdvisorRequest } from "../src/lib/waraApi.ts";

const root = dirname(fileURLToPath(import.meta.url));

assert.equal(typeof ensureRegisteredAdvisorHandoff, "function");
assert.equal(typeof ensureUnregisteredPhoneAdvisorHandoff, "function");

assert.ok(/deriv[eé]/i.test(REGISTERED_ADVISOR_HANDOFF_REPLY));
assert.ok(/asesor/i.test(REGISTERED_ADVISOR_HANDOFF_REPLY));
assert.ok(/asesor/i.test(REGISTERED_ADVISOR_HANDOFF_WAITING_REPLY));
assert.ok(
  /No encontré empresas asociadas a tu número en Wara\. Te derivo con un agente\./.test(
    UNREGISTERED_PHONE_FIRST_HANDOFF_REPLY,
  ),
);
assert.ok(/gu[ií]a.*cargar un n[uú]mero nuevo/i.test(UNREGISTERED_PHONE_FIRST_HANDOFF_REPLY));
assert.ok(/agente|asesor/i.test(UNREGISTERED_PHONE_FIRST_HANDOFF_REPLY));
assert.equal(UNREGISTERED_PHONE_WAITING_ADVISOR_REPLY, "");
assert.equal(UNREGISTERED_PHONE_TICKET_TITLE, "Número no registrado en Wara");

for (const msg of [
  "quiero hablar con un asesor",
  "pasame con un operador",
  "comunicame a mesa de entrada",
]) {
  assert.equal(looksLikeHumanAdvisorRequest(msg), true, msg);
  assert.equal(classifyTurnExecutor(msg, ""), "odoo_ticket", msg);
}

const odooRoute = readFileSync(join(root, "../src/app/api/odoo/ticket/route.ts"), "utf8");
assert.ok(
  odooRoute.includes("ensureRegisteredAdvisorHandoff"),
  "odoo/ticket debe crear ticket local al derivar",
);
assert.ok(
  !odooRoute.includes("const cfg = getOdooConfig();\n  if (!cfg) {\n    return NextResponse.json("),
  "odoo/ticket no debe bloquear derivación si Odoo no está configurado",
);

const builderbotCtx = readFileSync(
  join(root, "../src/lib/builderbotCustomerContext.ts"),
  "utf8",
);
assert.ok(
  builderbotCtx.includes("UNREGISTERED_PHONE_FIRST_HANDOFF_REPLY"),
  "builderbot context debe enviar aviso explícito al no registrado",
);

const turnExecutor = readFileSync(join(root, "../src/lib/whatsappTurnExecutor.ts"), "utf8");
assert.ok(
  turnExecutor.includes("ensureUnregisteredPhoneAdvisorHandoff"),
  "turn executor debe tener red de seguridad para no registrados",
);

console.log("OK verify-advisor-derivation-flow");
