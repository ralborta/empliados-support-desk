#!/usr/bin/env node
/**
 * Bug 2026-08-10: CONFIRMO pendiente + "No" — la IA (o heurística) razona
 * cancelar / reanudar consulta de estado, no "no era esa patente".
 */
import assert from "node:assert/strict";

const {
  hasPendingMantenimientoConfirmation,
  extractPendingMaintenanceDetalle,
  looksLikeBareNegativeResponse,
  looksLikeUnitRejection,
} = await import("../src/lib/wara.ts");
const { looksLikeGpsOrUnitStatusQuestion } = await import("../src/lib/waraApi.ts");
const {
  detectPendingConfirmKind,
  looksLikePendingConfirmPushback,
  reasonPendingConfirmationRejection,
} = await import("../src/lib/pendingConfirmStance.ts");
const { classifyTurnExecutor } = await import("../src/lib/whatsappTurnRouter.ts");

const pendingThread = [
  "Cliente: Quiero saber el estado de la Nissan",
  "Atilio: Voy a registrar:",
  "Patente: AG562SP",
  "Tipo: Gestion de mantenimiento",
  "Prioridad: normal",
  "Detalle: Quiero saber el estado de la Nissan",
  "",
  "Si esta correcto, responde CONFIRMO para registrarlo.",
].join("\n");

assert.equal(hasPendingMantenimientoConfirmation(pendingThread), true);
assert.equal(detectPendingConfirmKind(pendingThread), "mantenimiento");
assert.equal(looksLikePendingConfirmPushback("No", "mantenimiento"), true);
assert.equal(looksLikeBareNegativeResponse("No"), true);
assert.equal(looksLikeUnitRejection("No"), true);

const detalle = extractPendingMaintenanceDetalle(pendingThread);
assert.equal(detalle, "Quiero saber el estado de la Nissan");
assert.equal(looksLikeGpsOrUnitStatusQuestion(detalle), true);

// Sin API key / con IA off → heurística cancela y reanuda consulta
process.env.WARA_PENDING_CONFIRM_IA_ENABLED = "false";
const stance = await reasonPendingConfirmationRejection({
  selectionText: "No",
  threadText: pendingThread,
  kind: "mantenimiento",
});
assert.equal(stance.action, "cancel_and_resume_query");
assert.equal(stance.query, detalle);
assert.equal(stance.fuente, "heuristica");

assert.equal(
  classifyTurnExecutor("Quiero saber el estado de la Nissan", "Emii, sí, puedo ayudarte… mantenimiento"),
  "unidades",
);

console.log("OK verify-maintenance-confirm-no-cancels");
