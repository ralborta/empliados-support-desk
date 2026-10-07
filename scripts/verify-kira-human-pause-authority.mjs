#!/usr/bin/env node
/**
 * Contrato 2026-10-07 — autoridad humana sobre Kira:
 * - Botón «Reactivar Kira» siempre puede limpiar botPausedAt.
 * - Resolver/cerrar reactiva solo pausa auto (vía reactivateAtilioAfterTicketClosed).
 * - Handoffs / reasons arbitrarios NO reactivan directo.
 * - Entrega de /turn no envía texto ni PDF si hay pausa.
 *
 * Uso: npx tsx scripts/verify-kira-human-pause-authority.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  EXPLICIT_KIRA_REACTIVATE_REASON,
  RESOLVE_AUTO_REACTIVATE_REASON,
  isAllowedKiraReactivateReason,
  isExplicitKiraReactivateReason,
  isTerminalTicketStatus,
  reactivateAtilioAfterTicketClosed,
  reactivateAtilioForCustomer,
} from "../src/lib/atilioBotPause.ts";
import { createDeliverTurnToWhatsApp } from "../src/lib/whatsappTurnDelivery.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

assert.equal(isTerminalTicketStatus("RESOLVED"), true);
assert.equal(isTerminalTicketStatus("OPEN"), false);
assert.equal(isExplicitKiraReactivateReason(EXPLICIT_KIRA_REACTIVATE_REASON), true);
assert.equal(isAllowedKiraReactivateReason(RESOLVE_AUTO_REACTIVATE_REASON), true);
assert.equal(isExplicitKiraReactivateReason("unregistered_phone_handoff_keep_active"), false);
assert.equal(isAllowedKiraReactivateReason("advisor_handoff_keep_active"), false);
assert.equal(isAllowedKiraReactivateReason("panel:patch-status"), false);

const blocked = await reactivateAtilioForCustomer(
  "nonexistent-customer-id-pause-authority",
  undefined,
  "unregistered_phone_handoff_keep_active",
);
assert.equal(blocked, false, "reactivación no autorizada → false");

const closedMissing = await reactivateAtilioAfterTicketClosed(
  {
    customerId: "cust-missing-pause-authority",
    ticketId: "t-1",
    previousStatus: "OPEN",
    newStatus: "RESOLVED",
    reason: "panel:patch-status",
  },
  {
    customer: { findUnique: async () => null },
    ticket: { count: async () => 0 },
  },
);
assert.equal(closedMissing, false, "cierre sin customer → false");

const unreg = fs.readFileSync(path.join(root, "src/lib/unregisteredPhoneHandoff.ts"), "utf8");
assert.equal(
  /reactivateAtilioForCustomer/.test(unreg),
  false,
  "unregistered no llama reactivate",
);

const advisor = fs.readFileSync(path.join(root, "src/lib/advisorHandoff.ts"), "utf8");
assert.equal(
  /advisor_handoff_keep_active/.test(advisor),
  false,
  "advisor no reactiva keep_active",
);
assert.match(advisor, /pauseAtilioForCustomer/, "advisor sí puede pausar");

const messages = fs.readFileSync(
  path.join(root, "src/app/api/tickets/[id]/messages/route.ts"),
  "utf8",
);
assert.match(messages, /human_outbound_takeover/, "OUTBOUND HUMAN pausa");
assert.match(messages, /pauseSource:\s*"auto"/, "takeover marca pausa auto");

const clientes = fs.readFileSync(path.join(root, "src/app/api/clientes/[id]/route.ts"), "utf8");
assert.match(clientes, /panel:bot-paused-toggle/, "panel Reactivar Kira usa razón explícita");
assert.match(clientes, /pauseSource:\s*"manual"/, "botón Pausar marca manual");

const turn = fs.readFileSync(path.join(root, "src/lib/whatsappTurn.ts"), "utf8");
assert.match(
  turn,
  /Contrato 2026-10-01: con takeover humano NUNCA bypassear ignore/,
  "ignore humano sin bypass",
);

let sendCalls = 0;
const deliver = createDeliverTurnToWhatsApp({
  prisma: {},
  sendWhatsApp: async () => {
    sendCalls++;
    return { providerMessageId: "x" };
  },
  sendWhatsAppMessage: async () => {
    sendCalls++;
    return { data: {} };
  },
  isBotPausedForPhone: async () => true,
});

const blockedDelivery = await deliver("5492610000000", {
  message:
    "No encontré empresas asociadas a tu número en Wara. Te derivo con un agente.\n\n[[MEDIA_URL:https://example.com/guides/x.pdf]]",
  nextFlow: "reply",
  mediaUrl: "https://example.com/guides/x.pdf",
});
assert.equal(sendCalls, 0, "pausa → cero envíos");
assert.equal(blockedDelivery.skipResponse_s, "true");
assert.equal(blockedDelivery.waDelivery_s, "human_takeover_paused");
assert.equal(String(blockedDelivery.message ?? ""), "");
assert.equal(String(blockedDelivery.mediaUrl ?? ""), "");

console.log("OK verify-kira-human-pause-authority");
