#!/usr/bin/env node
/**
 * Bug prod 2026-08-18: certificado → patente → "900088" → "Unidad 900088"
 * enrutaba a GPS/estado en vez de continuar el certificado.
 * Causa: el agente parafraseaba el pedido de unidad sin ancla canónica y
 * certificateFlowState quedaba en "none".
 */
import assert from "node:assert/strict";
import { classifyTurnExecutor } from "../src/lib/whatsappTurnRouter.ts";
import {
  certificateFlowState,
  shouldContinueCertificateUnitCollection,
  threadHasCertificateUnitPrompt,
} from "../src/lib/wara.ts";

const baseThread = [
  "Cliente: Quiero un certificado",
  "Atilio: Para generar el certificado, necesito que me confirmes la patente de la unidad. ¿Cuál es?",
].join("\n");

const threadAfterClarify = [
  baseThread,
  "Cliente: 900088",
  "Atilio: ¿Es parte de la patente de la unidad?",
  "Cliente: Es la unidad",
  "Atilio: Dale, pasame la matrícula o el código de la unidad (ej. AD427MC o M900-114).",
].join("\n");

assert.equal(
  threadHasCertificateUnitPrompt(baseThread),
  true,
  "reconoce pedido de unidad parafraseado por el agente",
);
assert.equal(
  certificateFlowState(baseThread),
  "awaiting_unit",
  "certificateFlowState → awaiting_unit tras pedido de patente",
);
assert.equal(
  classifyTurnExecutor("900088", baseThread + "\nCliente: 900088"),
  "certificados",
  "900088 en trámite certificado → certificados",
);
assert.equal(
  shouldContinueCertificateUnitCollection("Es la unidad", threadAfterClarify),
  true,
  "aclaración 'Es la unidad' continúa certificado",
);
assert.equal(
  classifyTurnExecutor("Unidad 900088", threadAfterClarify + "\nCliente: Unidad 900088"),
  "certificados",
  "Unidad 900088 → certificados (no GPS)",
);

const threadM300 = [
  "Cliente: Quiero un certificado",
  "Atilio: 📋 *Certificado*\n\nPara el certificado de cobertura necesito la unidad:\n🔢 Pasame la *patente* (ej. AD 427 MC), el *código* (ej. M300-097, M600-170) o un *prefijo* (ej. HEJ).",
].join("\n");
assert.equal(
  classifyTurnExecutor("300097", threadM300 + "\nCliente: 300097"),
  "certificados",
  "300097 (sin prefijo 9) en certificado → certificados",
);
assert.equal(
  classifyTurnExecutor("Unidad M600-170", threadM300 + "\nCliente: Unidad M600-170"),
  "certificados",
  "M600-170 en certificado → certificados",
);
assert.equal(
  shouldContinueCertificateUnitCollection("600088", threadM300),
  true,
  "600088 continúa recolección de unidad en certificado",
);

console.log("OK verify-certificate-unit-code-continuation");
