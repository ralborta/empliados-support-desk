#!/usr/bin/env node
/**
 * Regresión 2026-08-17: tras formatMaintenanceConfirm (plantilla WhatsApp),
 * "Confirmo" no era aceptado porque hasPendingMantenimientoConfirmation
 * seguía buscando "Voy a registrar:".
 */
import assert from "node:assert/strict";

const { formatMaintenanceConfirm } = await import("../src/lib/waraWhatsAppFormat.ts");
const {
  hasPendingMantenimientoConfirmation,
  extractPendingMaintenanceDetalle,
  certificateFlowState,
} = await import("../src/lib/wara.ts");
const { classifyTurnExecutor } = await import("../src/lib/whatsappTurnRouter.ts");

const userRequest =
  "Quiero agendar mantenimiento preventivo para la unidad 900078 Cambio de sistema GPRS";
const confirmMessage = formatMaintenanceConfirm({
  unitLabel: "AC 899 JX",
  service: "Plan de mantenimiento",
  priorityLabel: "normal",
  detalle: userRequest,
});

const pendingThread = [
  `Cliente: ${userRequest}`,
  `Atilio: ${confirmMessage}`,
].join("\n");

assert.equal(hasPendingMantenimientoConfirmation(pendingThread), true, "detecta confirmación WhatsApp");
assert.equal(
  extractPendingMaintenanceDetalle(pendingThread),
  userRequest,
  "extrae detalle del formato WhatsApp",
);
assert.equal(
  classifyTurnExecutor("Confirmo", pendingThread),
  "info_guides",
  "Confirmo legacy de mantenimiento → guía app (operativo WA off)",
);

const afterConfirmLoop = [
  pendingThread,
  "Cliente: Confirmo",
  `Atilio: ${formatMaintenanceConfirm({
    unitLabel: "AC 899 JX",
    service: "Plan de mantenimiento",
    priorityLabel: "normal",
    detalle: "Plan de mantenimiento para AC899JX",
  })}`,
].join("\n");
assert.equal(
  hasPendingMantenimientoConfirmation(afterConfirmLoop),
  true,
  "sigue pendiente si el bot repitió confirmación (db pending simulado en hilo)",
);

const certThread = [
  "Atilio: 📋 *Confirmar certificado*",
  "🚗 Unidad: *AC 899 JX*",
  "🏢 Empresa: *Demo S.A.*",
  "",
  "¿Confirmás la solicitud a WARA?",
  "➡️ Respondé *CONFIRMO* o *CANCELAR*.",
].join("\n");
assert.equal(certificateFlowState(certThread), "awaiting_confirm", "certificado formato WhatsApp");

console.log("OK verify-maintenance-whatsapp-confirm-format");
