#!/usr/bin/env node
/**
 * Bug real, producción 2026-08-24: "Gps" solo se tomaba como prefijo de patente
 * ("unidad no encontrada… empiece con GPS") en vez de pedido de estado/reporte.
 * Debe: (1) no ser prefijo, (2) ser consulta GPS, (3) rutar a unidades.
 */
import assert from "node:assert/strict";
import {
  extractPlatePrefixFromMessage,
  isBarePlatePrefixHint,
} from "../src/lib/wara.ts";
import { looksLikeGpsOrUnitStatusQuestion } from "../src/lib/waraApi.ts";
import { classifyTurnExecutor } from "../src/lib/whatsappTurnRouter.ts";

const menuThread = [
  "Cliente: Hola",
  "Atilio: ¿En qué te ayudo?",
  "• 📍 GPS / reporte",
].join("\n");

const bareServiceWords = ["Gps", "GPS", "gps", "estado", "Estado", "reporte", "Reporte"];

for (const text of bareServiceWords) {
  assert.equal(
    isBarePlatePrefixHint(text),
    false,
    `"${text}" NO debe ser prefijo de patente`,
  );
  assert.equal(
    extractPlatePrefixFromMessage(text),
    null,
    `"${text}" NO debe extraer prefijo`,
  );
  assert.equal(
    looksLikeGpsOrUnitStatusQuestion(text),
    true,
    `"${text}" debe ser consulta de estado/GPS`,
  );
  assert.equal(
    classifyTurnExecutor(text, menuThread),
    "unidades",
    `router "${text}" → unidades`,
  );
}

// Con unidad / frases naturales siguen andando (regresión).
assert.equal(looksLikeGpsOrUnitStatusQuestion("GPS 900133"), true);
assert.equal(looksLikeGpsOrUnitStatusQuestion("quiero el estado"), true);
assert.equal(looksLikeGpsOrUnitStatusQuestion("estado de la unidad"), true);
assert.equal(isBarePlatePrefixHint("AD"), true, "prefijo real AD sigue siendo prefijo");
assert.equal(extractPlatePrefixFromMessage("la q empieza con AD"), "AD");
assert.equal(extractPlatePrefixFromMessage("Gps"), null);

// Wrappers cortos.
for (const text of ["el gps", "dame el reporte", "quiero gps", "mi estado"]) {
  assert.equal(
    looksLikeGpsOrUnitStatusQuestion(text),
    true,
    `"${text}" debe ser consulta GPS`,
  );
  assert.equal(isBarePlatePrefixHint(text), false);
}

console.log("✓ verify-bare-gps-not-plate-prefix OK");
