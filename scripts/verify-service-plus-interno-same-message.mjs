#!/usr/bin/env node
/**
 * Servicio + interno en el mismo mensaje: extracción y resolución de rol.
 */
import assert from "node:assert/strict";
import {
  detectServiceIntentInMessage,
  extractEmbeddedNumericReferences,
  resolveNumericRole,
  resolveUnitReferenceFromMessage,
} from "../src/lib/unitReferenceParser.ts";
import {
  extractMovilIdFromUnitMessage,
  inferNumericExpectedFieldForThread,
  resolveUnitQuery,
  resolveExecutorOverStaleMaintenancePlateSelection,
} from "../src/lib/waraUnitIntent.ts";
import {
  hasPendingMaintenancePlateRequest,
  hasPendingUnitConsultPlateRequest,
  threadAwaitingOdometerPlate,
  threadHasActiveMeterValueRequest,
} from "../src/lib/wara.ts";
import { shouldInterpretAmbiguousUtterance } from "../src/lib/utteranceUnderstanding.ts";
import { classifyTurnExecutor } from "../src/lib/whatsappTurnRouter.ts";

const fleet = [
  { movil_id: 900100, unidad: "M900-100", patente: "AA900100" },
  { movil_id: 900079, unidad: "M900-079", patente: "AA900079" },
  { movil_id: 900077, unidad: "M900-077", patente: "AA100ZZ" },
];

// — Fase 1: extracción —
assert.deepEqual(
  extractEmbeddedNumericReferences("Estado 900100").map((r) => r.value),
  [900100],
);
assert.deepEqual(
  extractEmbeddedNumericReferences("Estado de 900100").map((r) => r.value),
  [900100],
);
assert.equal(extractEmbeddedNumericReferences("Fecha 20/08/2026").length, 0);
assert.equal(detectServiceIntentInMessage("Estado 900100"), "estado_gps");
assert.equal(detectServiceIntentInMessage("Certificado 900100"), "certificado");
assert.equal(detectServiceIntentInMessage("Odometro 900100"), "odometro");

// — Fase 2: rol —
const estadoRole = resolveUnitReferenceFromMessage({ rawText: "Estado 900100" });
assert.equal(estadoRole.kind, "unit");
assert.equal(estadoRole.unitMovilId, 900100);

const certRole = resolveUnitReferenceFromMessage({ rawText: "Certificado 900100" });
assert.equal(certRole.unitMovilId, 900100);

const odoNoFleet = resolveUnitReferenceFromMessage({ rawText: "Odometro 900100" });
assert.equal(odoNoFleet.unitMovilId, 900100);

const odoInFleet = resolveUnitReferenceFromMessage({
  rawText: "Odometro 900100",
  fleet,
});
assert.equal(odoInFleet.unitMovilId, 900100);

const odoMissing = resolveUnitReferenceFromMessage({
  rawText: "Odometro 999999",
  fleet,
});
assert.equal(odoMissing.kind, "ambiguous");

const dual = resolveNumericRole({
  rawText: "Odometro 900100 125000",
  candidates: extractEmbeddedNumericReferences("Odometro 900100 125000"),
  serviceIntent: "odometro",
  expectedField: "none",
  fleet,
});
assert.equal(dual.kind, "dual");
assert.equal(dual.unitMovilId, 900100);
assert.equal(dual.meterValue, 125000);

const agentOdometerThread = [
  "Cliente: Odometro",
  "Atilio: Para poder registrar el cambio de odómetro, necesito algunos datos:",
  "1. ¿Cuál es la patente de la unidad?",
  "2. ¿Qué valor nuevo de odómetro querés registrar en kilómetros?",
].join("\n");

assert.equal(inferNumericExpectedFieldForThread(agentOdometerThread), "unit");
assert.equal(extractMovilIdFromUnitMessage("900079", { threadText: agentOdometerThread }), 900079);
assert.equal(
  shouldInterpretAmbiguousUtterance("900079", agentOdometerThread),
  false,
);

const valueThread = [
  "Cliente: Odometro",
  "Atilio: Pasame el valor del odómetro en km para NKL 961.",
].join("\n");
assert.equal(threadHasActiveMeterValueRequest(valueThread), true);
assert.equal(inferNumericExpectedFieldForThread(valueThread), "meter_value");
assert.equal(extractMovilIdFromUnitMessage("900100", { threadText: valueThread }), null);
const meterRole = resolveUnitReferenceFromMessage({
  rawText: "900100",
  expectedField: "meter_value",
});
assert.equal(meterRole.kind, "meter_value");
assert.equal(meterRole.meterValue, 900100);

assert.equal(extractMovilIdFromUnitMessage("Estado 900100"), 900100);
assert.equal(extractMovilIdFromUnitMessage("Estado de 900100"), 900100);
assert.equal(
  shouldInterpretAmbiguousUtterance("Estado 900100", ""),
  false,
  "Estado+interno no debe ir a utterance IA",
);

const casoAmbiguo = resolveUnitReferenceFromMessage({ rawText: "Caso 900100" });
assert.equal(casoAmbiguo.kind, "none", "sin servicio ni hilo, no asumir unidad");

const resolved = await resolveUnitQuery({
  rawText: "Estado 900100",
  threadText: "",
  units: fleet,
  preferAi: false,
});
assert.equal(resolved.plate, "AA900100");
assert.equal(classifyTurnExecutor("Estado 900100", ""), "unidades");

const maintThread =
  "Para programar mantenimiento preventivo necesito la patente de la unidad. Voy a registrar mantenimiento.";
assert.equal(
  resolveExecutorOverStaleMaintenancePlateSelection("Estado 900100", maintThread),
  "unidades",
  "Estado+interno → unidades",
);
assert.equal(
  resolveExecutorOverStaleMaintenancePlateSelection("Certificado 900100", maintThread),
  "certificados",
  "Certificado+interno → certificados",
);
assert.equal(
  resolveExecutorOverStaleMaintenancePlateSelection("Odometro 900100", maintThread),
  "odometro",
  "Odometro+interno → odometro",
);
assert.equal(
  resolveExecutorOverStaleMaintenancePlateSelection("Horometro 900079", maintThread),
  "odometro",
  "Horometro+interno → odometro",
);
assert.equal(
  classifyTurnExecutor("Estado 900100", maintThread),
  "unidades",
  "router Estado → unidades con mantenimiento stale",
);
assert.equal(
  classifyTurnExecutor("Certificado 900100", maintThread),
  "certificados",
  "router Certificado → certificados con mantenimiento stale",
);
assert.equal(
  classifyTurnExecutor("Odometro 900100", maintThread),
  "odometro",
  "router Odometro → odometro con mantenimiento stale",
);

const gpsAskAfterMaint =
  "Para programar mantenimiento preventivo necesito la patente de la unidad.\n" +
  "¿Podés darme la patente o el interno de la unidad? Consulto en Wara.";
assert(
  !hasPendingMaintenancePlateRequest(gpsAskAfterMaint),
  "pedido GPS más reciente anula mantenimiento stale",
);
assert(hasPendingUnitConsultPlateRequest(gpsAskAfterMaint), "detecta pedido interno GPS reciente");
assert.equal(inferNumericExpectedFieldForThread(gpsAskAfterMaint), "unit");
assert.equal(extractMovilIdFromUnitMessage("900100", { threadText: gpsAskAfterMaint }), 900100);
assert.equal(
  classifyTurnExecutor("900100", gpsAskAfterMaint),
  "unidades",
  "interno solo tras pedido GPS reciente → unidades",
);

console.log("OK verify-service-plus-interno-same-message");
