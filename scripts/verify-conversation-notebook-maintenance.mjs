#!/usr/bin/env node
/**
 * Cuaderno de sesión + detalle de mantenimiento — no usar "Si" como Detalle.
 * Rollback: WARA_CONVERSATION_NOTEBOOK=false
 */
import assert from "node:assert";

let passed = 0;
function check(label, cond) {
  assert.ok(cond, label);
  passed++;
  console.log(`  ✓ ${label}`);
}

const prev = process.env.WARA_CONVERSATION_NOTEBOOK;
process.env.WARA_CONVERSATION_NOTEBOOK = "false";

const {
  isConversationNotebookEnabled,
  resolveMaintenanceDetailText,
  isMaintenanceAffirmationWithoutFormalSummary,
} = await import("../src/lib/conversationNotebook.ts");

check("flag off", !isConversationNotebookEnabled());

process.env.WARA_CONVERSATION_NOTEBOOK = "true";
check("flag on", isConversationNotebookEnabled());

const detalleSi = resolveMaintenanceDetailText({
  inboundText: "Si",
  service: "Plan de mantenimiento",
  plate: "AE483VE",
});
check("Si no es detalle literal", detalleSi.includes("Plan de mantenimiento") && !/^s[ií]$/i.test(detalleSi));

check(
  "Preventivo incluye patente",
  resolveMaintenanceDetailText({
    inboundText: "Preventivo",
    service: "Plan de mantenimiento",
    plate: "AE483VE",
  }).includes("AE483VE"),
);

check(
  "detalle sustantivo se conserva",
  resolveMaintenanceDetailText({
    inboundText: "Preventivo por filtro de aceite",
    service: "Plan de mantenimiento",
    plate: "AE483VE",
  }).includes("filtro"),
);

check(
  "afirmación informal tras oferta de mantenimiento",
  isMaintenanceAffirmationWithoutFormalSummary({
    inboundText: "Si",
    pendingFormalConfirm: false,
    hasPlateContext: true,
    threadText:
      "¿Querés que avance con el mantenimiento preventivo para la unidad AG 562 SP?",
  }),
);

process.env.WARA_CONVERSATION_NOTEBOOK = prev ?? "";

console.log(`\n✅ ${passed} checks pasaron.`);
