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
  ADVISOR_OFFLINE_SOON_REPLY,
  buildPresenceAwareAdvisorHandoffReply,
  ensureRegisteredAdvisorHandoff,
  REGISTERED_ADVISOR_HANDOFF_REPLY,
  REGISTERED_ADVISOR_HANDOFF_WAITING_REPLY,
  withAdvisorOfflineNoticeIfNeeded,
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

const onlineCase = buildPresenceAwareAdvisorHandoffReply({
  advisorOnline: true,
  caseRef: "398566",
  explicitAdvisorRequest: true,
});
assert.match(onlineCase, /Tu caso es \*#398566\*/);
assert.doesNotMatch(onlineCase, /no hay un asesor conectado/);
const offlineCase = buildPresenceAwareAdvisorHandoffReply({
  advisorOnline: false,
  caseRef: "398566",
  explicitAdvisorRequest: true,
});
assert.match(offlineCase, /Tu caso es \*#398566\*/);
assert.match(offlineCase, /no hay un asesor conectado/);
assert.equal(
  withAdvisorOfflineNoticeIfNeeded("Un asesor de Atención al cliente lo va a revisar.", true),
  "Un asesor de Atención al cliente lo va a revisar.",
);
assert.equal(
  withAdvisorOfflineNoticeIfNeeded("Un asesor de Atención al cliente lo va a revisar.", false),
  ADVISOR_OFFLINE_SOON_REPLY,
);
assert.ok(
  /No encontré empresas asociadas a tu número en Wara\. Te derivo con un agente\./.test(
    UNREGISTERED_PHONE_FIRST_HANDOFF_REPLY,
  ),
);
assert.ok(/gu[ií]a.*cargar un n[uú]mero nuevo/i.test(UNREGISTERED_PHONE_FIRST_HANDOFF_REPLY));
assert.ok(/agente|asesor/i.test(UNREGISTERED_PHONE_FIRST_HANDOFF_REPLY));
assert.match(
  UNREGISTERED_PHONE_WAITING_ADVISOR_REPLY,
  /no está registrado/i,
  "recontacto: siempre contesta (no silencio)",
);
assert.match(UNREGISTERED_PHONE_WAITING_ADVISOR_REPLY, /gu[ií]a/i);
assert.doesNotMatch(
  UNREGISTERED_PHONE_WAITING_ADVISOR_REPLY,
  /ticket\s+\d+/i,
  "recontacto: no entregar número de ticket al cliente",
);
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
  odooRoute.includes("hasConnectedSupportAdvisor") &&
    odooRoute.includes("buildPresenceAwareAdvisorHandoffReply"),
  "odoo/ticket usa presencia de asesor para el texto al cliente",
);
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
