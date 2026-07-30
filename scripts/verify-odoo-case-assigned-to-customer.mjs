#!/usr/bin/env node
/**
 * Regresión — cuando se crea/asigna un caso en Odoo Helpdesk, el mensaje al cliente
 * debe incluir «Tu caso es #…» (referencia Odoo). Sin Odoo, no inventar número.
 * Nunca TCK-* local en WhatsApp.
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
  buildCustomerOdooCaseAssignedReply,
  withOdooCaseAssignedSuffix,
  buildCustomerExplicitCaseNumberReply,
} from "../src/lib/customerOdooCaseRef.ts";
import { buildTemplateSummary } from "../src/lib/waraGpsSummary.ts";

console.log("▶ buildCustomerOdooCaseAssignedReply");
const assigned = buildCustomerOdooCaseAssignedReply("36248");
check("incluye Tu caso es #36248", assigned.includes("Tu caso es") && assigned.includes("#36248"));
check("no incluye TCK", !assigned.includes("TCK"));

const reused = buildCustomerOdooCaseAssignedReply("36248", { reused: true });
check("reutilizado menciona #36248", reused.includes("#36248"));
check("reutilizado no dice Tu caso es", !/Tu caso es/i.test(reused));

console.log("\n▶ withOdooCaseAssignedSuffix");
const suffixed = withOdooCaseAssignedSuffix("La unidad presenta falta de reporte.", "36248");
check("suffix incluye #36248", suffixed.includes("#36248"));

console.log("\n▶ buildTemplateSummary con odooRef");
const gps = buildTemplateSummary({
  unitLabel: "NKL 961",
  unit: { patente: "NKL961", unidad: "M300-114" },
  assessment: { status: "missing_report", reportElapsed: 999999, reason: "sin reporte" },
  action: "ticket",
  odooRef: "36248",
  ticketIssueDetail: "falta de reporte",
});
check("GPS template incluye Tu caso es", gps.includes("Tu caso es") && gps.includes("#36248"));

console.log("\n▶ Rutas usan helpers de caso Odoo al cliente");
for (const rel of [
  "src/app/api/wara/unidades/route.ts",
  "src/app/api/odoo/ticket/route.ts",
  "src/app/api/wara/certificados/route.ts",
  "src/app/api/wara/mantenimiento-operativo/route.ts",
]) {
  const content = fs.readFileSync(path.join(root, rel), "utf8");
  check(
    `${rel} importa helper de caso Odoo`,
    /buildCustomerOdooCaseAssignedReply|withOdooCaseAssignedSuffix/.test(content),
  );
  check(`${rel} no interpola ticket.code al cliente`, !/`\$\{ticket\.code\}/.test(content));
}

console.log("\n▶ Pedido explícito sigue usando Odoo");
check(
  "buildCustomerExplicitCaseNumberReply intacto",
  buildCustomerExplicitCaseNumberReply("36248").includes("#36248"),
);

console.log(`\n✅ ${passed} checks pasaron.`);
