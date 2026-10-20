#!/usr/bin/env node
/**
 * Bug prod 2026-08-18: certificado en CONFIRMO para AB 042 BB →
 * "Para otra unidad 900076" repetía "respondé CONFIRMO" en vez de pivotar a la nueva unidad.
 */
import assert from "node:assert/strict";
import { looksLikeCertificateUnitPivot } from "../src/lib/certificateFlowMessages.ts";
import { classifyTurnExecutor } from "../src/lib/whatsappTurnRouter.ts";
import { certificateFlowState } from "../src/lib/wara.ts";

const confirmThread = [
  "Cliente: Quiero un certificado",
  "Atilio: 📋 *Confirmar certificado*",
  "🚗 Unidad: *AB 042 BB*",
  "🏢 Empresa: *El Cacique S.A.*",
  "¿Confirmás la solicitud a WARA?",
  "➡️ Respondé *CONFIRMO* o *CANCELAR*.",
].join("\n");

assert.equal(certificateFlowState(confirmThread), "awaiting_confirm");

const pivots = [
  "Para otra unidad 900076",
  "para otra unidad 600088",
  "Quiero consultar por otra unidad M300-097",
  "cambiar de unidad 300097",
];

for (const text of pivots) {
  assert.equal(
    looksLikeCertificateUnitPivot(text),
    true,
    `looksLikeCertificateUnitPivot("${text}")`,
  );
  assert.equal(
    classifyTurnExecutor(text, `${confirmThread}\nCliente: ${text}`),
    "certificados",
    `"${text}" en CONFIRMO certificado → certificados`,
  );
}

assert.equal(
  looksLikeCertificateUnitPivot("CONFIRMO"),
  false,
  "CONFIRMO no es pivot de unidad",
);

console.log("OK verify-certificate-unit-pivot-during-confirm");
