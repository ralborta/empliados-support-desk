#!/usr/bin/env node
/**
 * Bug real 2026-08-06 (prueba clientes):
 * 1) Genera ticket Odoo pero no pasa el número.
 * 2) "Hay un caso abierto" no aclara si es nuevo o ya existía.
 *
 * Uso: npx tsx scripts/verify-odoo-case-client-message.mjs
 */
import {
  buildCustomerOdooCaseAssignedReply,
  ensureOdooCaseRefInClientMessage,
  withOdooCaseAssignedSuffix,
} from "../src/lib/customerOdooCaseRef.ts";
import { buildTemplateSummary } from "../src/lib/waraGpsSummary.ts";

let failed = 0;
function assert(cond, label) {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}

const unit = {
  movil_id: 1,
  patente: "AI154GD",
  unidad: "M300-092",
  ultimo_reporte: { fecha: "2026-08-06 09:00:00", antiguedad_segundos: 10800 },
  ultima_posicion: { fecha: "2026-08-06 09:00:00", antiguedad_segundos: 10800 },
  ignicion: { estado: "OFF", fecha: "2026-08-06 08:00:00", antiguedad_segundos: 14400 },
};

const assessment = {
  status: "missing_report",
  reportElapsed: 10800,
  positionElapsed: 10800,
  ignitionElapsed: 14400,
  reason: "sin reporte",
};

console.log("— Caso NUEVO con número Odoo —");
const neu = buildTemplateSummary({
  unitLabel: "AI 154 GD (M300-092)",
  unit,
  assessment,
  action: "ticket",
  odooRef: "36248",
  ticketReused: false,
  ticketIssueDetail: "falta de reporte: el GPS no envía datos hace 3 horas",
});
assert(neu.includes("#36248") || neu.includes("36248"), "incluye número Odoo");
assert(/gener[eé]/i.test(neu), "dice que GENERÓ el caso");
assert(!/ya estaba abierto|ya tenías/i.test(neu), "no dice que ya existía");

console.log("\n— Caso REUTILIZADO con número Odoo —");
const reu = buildTemplateSummary({
  unitLabel: "AI 154 GD (M300-092)",
  unit,
  assessment,
  action: "ticket",
  odooRef: "36248",
  ticketReused: true,
  ticketIssueDetail: "falta de reporte: el GPS no envía datos hace 3 horas",
});
assert(reu.includes("36248"), "incluye número Odoo");
assert(/ya estaba abierto|no gener/i.test(reu), "aclara que YA existía / no generó uno nuevo");

console.log("\n— Suffix y reinjection —");
const sufNew = withOdooCaseAssignedSuffix("La unidad no reporta.", "36248", { reused: false });
assert(/Generé el caso \*#36248\*/i.test(sufNew), "suffix nuevo");
const sufOld = withOdooCaseAssignedSuffix("La unidad no reporta.", "36248", { reused: true });
assert(/ya estaba abierto \(\*#36248\*\)/i.test(sufOld), "suffix reutilizado");

const dropped = ensureOdooCaseRefInClientMessage(
  "La unidad AI 154 GD no está reportando. Ya hay un caso abierto y se está revisando.",
  "36248",
  { reused: false },
);
assert(dropped.includes("36248"), "reinyecta # si la IA lo omitió");
assert(/Generé el caso/i.test(dropped), "reinyección aclara que es nuevo");

const droppedReused = ensureOdooCaseRefInClientMessage(
  "La unidad AH 881 XF (M600-060) no está reportando. Ya tenemos el caso abierto y se está revisando.",
  "36806",
  { reused: true },
);
assert(droppedReused.includes("36806"), "reinyecta # en caso reutilizado (bug M600-060)");
assert(/ya estaba abierto/i.test(droppedReused), "reinyección reutilizado aclara que ya existía");

const assigned = buildCustomerOdooCaseAssignedReply("36248", { reused: false });
assert(assigned.includes("#36248"), "reply explícito con #");

// Hechos del dialogue_state deben traer el # (el agente no puede inventarlo ni omitirlo).
const { buildGpsAssessmentDialogueState } = await import("../src/lib/unitDialogueState.ts");
const dialogue = buildGpsAssessmentDialogueState({
  unit,
  rawText: "interno 600-060 no reporta",
  assessment,
  action: "ticket",
  ticketRef: "36806",
  ticketReused: true,
  odooRef: "36806",
  ticketIssueDetail: "falta de reporte: el GPS no envía datos hace 2 horas",
});
const hechosBlob = dialogue.hechos.join(" ");
assert(hechosBlob.includes("36806"), "hechos incluyen número Odoo");
assert(dialogue.caso_odoo === "36806", "caso_odoo en dialogue_state");
assert(dialogue.caso_reutilizado === true, "caso_reutilizado=true");
assert(!/ya existe un caso abierto; se actualizó/i.test(hechosBlob), "no omitir # en hechos reutilizados");

if (failed > 0) {
  console.error(`\n✗ ${failed} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ Mensajes de caso Odoo al cliente OK");
