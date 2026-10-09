#!/usr/bin/env node
/**
 * Bug 2026-08-23: "Horometro 900133" tras menú → silencio.
 * Extendido: cualquier servicio + interno (certificado, GPS/estado, mantenimiento)
 * debe rutar y reconocerse como arranque operativo (nunca silencio por menú/guía).
 */
import assert from "node:assert/strict";
import {
  looksLikeExplicitOdometerUpdateRequest,
  looksLikeHorometerOnlyIntent,
  looksLikeOdometerServiceWithUnitReference,
  looksLikeOdometerIntentStart,
  looksLikeOdometerHelpRequest,
  looksLikeNamedServiceWithUnitReference,
  looksLikeCertificateKeyword,
} from "../src/lib/wara.ts";
import {
  shouldContinueOdometerFlow,
  looksLikeOperationalMaintenanceIntent,
  looksLikeGpsOrUnitStatusQuestion,
} from "../src/lib/waraApi.ts";
import {
  looksLikeResolvableUnitReferenceInMessage,
  shouldRouteGpsConsultToUnidades,
} from "../src/lib/gpsConsultRouting.ts";
import { classifyTurnExecutor } from "../src/lib/whatsappTurnRouter.ts";

const menuThread = [
  "Cliente: Hola",
  "Atilio: 👋 Hola",
  "🏢 Seguimos con *El Cacique S.A.*.",
  "¿En qué te ayudo?",
  "• 🛣 Odómetro / ⏱ horómetro",
  "• 📋 Certificado",
  "• 📍 GPS / reporte",
  "• 🔧 Mantenimiento",
].join("\n");

const msg = "Horometro 900133";
assert.equal(looksLikeHorometerOnlyIntent(msg), true);
assert.equal(looksLikeOdometerServiceWithUnitReference(msg), true);
assert.equal(looksLikeNamedServiceWithUnitReference(msg), true);
assert.equal(looksLikeExplicitOdometerUpdateRequest(msg), true);
assert.equal(classifyTurnExecutor(msg, menuThread), "odometro");

const odometerFlowStart =
  looksLikeOdometerIntentStart(msg) ||
  looksLikeOdometerHelpRequest(msg) ||
  looksLikeHorometerOnlyIntent(msg) ||
  looksLikeOdometerServiceWithUnitReference(msg);
assert.equal(odometerFlowStart, true, "flow start debe incluir horómetro+interno");

assert.equal(
  shouldContinueOdometerFlow(msg, menuThread),
  true,
  "no debe cortarse por menú previo",
);

const afterConfirmThread = [
  "Atilio: 🛣 *Confirmar odómetro*",
  "Cliente: CONFIRMO",
  "Atilio: Listo, registré el cambio.",
].join("\n");
assert.equal(
  shouldContinueOdometerFlow(msg, afterConfirmThread),
  true,
  "arranque horómetro gana sobre hilo superseded",
);

/** Todos los servicios: router + reconocimiento servicio+interno. */
const cases = [
  { text: "Horometro 900133", executor: "odometro" },
  { text: "Odometro 900112", executor: "odometro" },
  { text: "Certificado 900133", executor: "certificados" },
  { text: "Cobertura 900133", executor: "certificados" },
  { text: "GPS 900133", executor: "unidades" },
  { text: "Estado 900133", executor: "unidades" },
  { text: "Reporte 900133", executor: "unidades" },
  { text: "Mantenimiento 900133", executor: "mantenimiento" },
  { text: "Preventivo 900133", executor: "mantenimiento" },
];

for (const { text, executor } of cases) {
  assert.equal(
    classifyTurnExecutor(text, menuThread),
    executor,
    `router ${text} → ${executor}`,
  );
  assert.equal(
    looksLikeNamedServiceWithUnitReference(text),
    true,
    `named service+unit: ${text}`,
  );
  assert.equal(
    looksLikeResolvableUnitReferenceInMessage(text),
    true,
    `resolvable unit: ${text}`,
  );
}

assert.equal(looksLikeCertificateKeyword("Certificado 900133"), true);
assert.equal(looksLikeGpsOrUnitStatusQuestion("GPS 900133"), true);
assert.equal(looksLikeGpsOrUnitStatusQuestion("Estado 900133"), true);
assert.equal(shouldRouteGpsConsultToUnidades("GPS 900133"), true);
assert.equal(looksLikeOperationalMaintenanceIntent("Mantenimiento 900133", menuThread), true);
assert.equal(looksLikeOperationalMaintenanceIntent("Preventivo 900133", menuThread), true);

console.log("✓ verify-horometro-interno-no-silence OK (todos los servicios)");
