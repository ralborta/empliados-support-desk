#!/usr/bin/env node
/**
 * Regresión — al informar número de caso al cliente solo debe usarse referencia Odoo (#36248),
 * nunca código local TCK-* ni ticket.code en templates WhatsApp.
 */
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

let passed = 0;
function check(label, cond) {
  assert.ok(cond, label);
  passed++;
  console.log(`  ✓ ${label}`);
}

import {
  normalizeCustomerOdooCaseRef,
  formatCustomerOdooCaseRefForWhatsApp,
  buildCustomerExplicitCaseNumberReply,
  buildCaseRegisteredWithoutOdooRefReply,
} from "../src/lib/customerOdooCaseRef.ts";

console.log("▶ normalizeCustomerOdooCaseRef");
check("#36248", normalizeCustomerOdooCaseRef("#36248") === "36248");
check("36248", normalizeCustomerOdooCaseRef("36248") === "36248");
check("Caso (#36248)", normalizeCustomerOdooCaseRef("Caso (#36248)") === "36248");
check("TCK rechazado", normalizeCustomerOdooCaseRef("TCK-2026-0001-42") === null);
check("vacío", normalizeCustomerOdooCaseRef("") === null);

console.log("\n▶ formatCustomerOdooCaseRefForWhatsApp");
check("formatea con #", formatCustomerOdooCaseRefForWhatsApp("36248") === "#36248");

console.log("\n▶ buildCustomerExplicitCaseNumberReply");
const explicit = buildCustomerExplicitCaseNumberReply("36248");
check("incluye #36248", explicit.includes("#36248"));
check("no incluye TCK", !explicit.includes("TCK"));

console.log("\n▶ buildCaseRegisteredWithoutOdooRefReply");
const without = buildCaseRegisteredWithoutOdooRefReply();
check("sin número", !/\d{4,}/.test(without));

console.log("\n▶ inbound no interpola ticket.code al cliente");
const inbound = fs.readFileSync(path.join(root, "src/app/api/whatsapp/inbound/route.ts"), "utf8");
check("sin Ticket: *${ticket.code}", !/Ticket:\s*\*\$\{ticket\.code\}/.test(inbound));
check("sin Tu número de caso (ticket) es *${ticket.code}", !/Tu número de caso \(ticket\) es \*\$\{ticket\.code\}/.test(inbound));

console.log("\n▶ buildOpenCaseStatusReply usa Odoo, no openTicket.code");
const ticketInquiry = fs.readFileSync(path.join(root, "src/lib/customerTicketInquiry.ts"), "utf8");
check("no openTicket.code en reply", !/openTicket\.code/.test(ticketInquiry));
check("usa formatCustomerOdooCaseRefForWhatsApp", /formatCustomerOdooCaseRefForWhatsApp/.test(ticketInquiry));

console.log(`\n✅ ${passed} checks pasaron.`);
