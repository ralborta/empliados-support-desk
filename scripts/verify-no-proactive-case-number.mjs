#!/usr/bin/env node
/**
 * Regresión — Pedido explícito, 2026-07-29: el bot NO debe informar proactivamente el
 * número de caso/ticket en sus respuestas (ni al crearlo ni al reutilizar uno existente).
 * El número de caso solo debe aparecer si el cliente lo pide explícitamente
 * (looksLikeOpenCaseStatusInquiry -> buildOpenCaseStatusReply, messageAsksForTicketCode, etc.)
 * y en ese caso solo la referencia Odoo (#36248), nunca TCK-* local.
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

const filesToScan = [
  "src/app/api/odoo/ticket/route.ts",
  "src/app/api/wara/unidades/route.ts",
  "src/app/api/wara/certificados/route.ts",
  "src/app/api/wara/mantenimiento-operativo/route.ts",
  "src/lib/waraGpsSummary.ts",
];

// Patrones que indican que el número/código del caso se está interpolando directo en un
// mensaje al cliente (no en el payload de respuesta JSON, que sí puede llevar `ref`/`code`
// para uso interno de BuilderBot/analytics).
const forbiddenPatterns = [
  /caso\s+N[°º]\s*\$\{/i,
  /el caso\s+\$\{/i,
  /caso abierto\s*\(\$\{/i,
  /en revisión\.\s*\$\{ref/i,
  /Caso Odoo\s*\$\{/i,
  /Caso\s+\$\{ticket\.code\}/i,
  /Ticket:\s*\*\$\{ticket\.code\}/i,
  /`[^`]*caso[^`]*\$\{[a-zA-Z.]*(ref|code|odooRef)[a-zA-Z.]*\}[^`]*`/i,
];

console.log("▶ Ningún template de mensaje al cliente interpola el número de caso");
for (const relPath of filesToScan) {
  const fullPath = path.join(root, relPath);
  const content = fs.readFileSync(fullPath, "utf8");
  for (const pattern of forbiddenPatterns) {
    check(`${relPath} no matchea ${pattern}`, !pattern.test(content));
  }
}

console.log("\n▶ El path de pedido explícito usa referencia Odoo, no openTicket.code");
const ticketInquiryContent = fs.readFileSync(
  path.join(root, "src/lib/customerTicketInquiry.ts"),
  "utf8",
);
check(
  "buildOpenCaseStatusReply no usa openTicket.code",
  !/openTicket\.code/.test(ticketInquiryContent),
);
check(
  "buildOpenCaseStatusReply usa formatCustomerOdooCaseRefForWhatsApp",
  /formatCustomerOdooCaseRefForWhatsApp/.test(ticketInquiryContent),
);

console.log(`\n✅ ${passed} checks pasaron.`);
