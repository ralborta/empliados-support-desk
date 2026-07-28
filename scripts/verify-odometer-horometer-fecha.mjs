#!/usr/bin/env node
/**
 * Regresión bug 2026-07-27: horómetro "a las 16:55 de hoy" + corrección de fecha.
 */
import { parseFechaFromText } from "../src/lib/odometroFecha.ts";
import { mergeOdometerFieldExtractions } from "../src/lib/odometroHorometroExtract.ts";
import {
  looksLikeOdometerPendingDataAmendment,
} from "../src/lib/wara.ts";
import { classifyTurnExecutor } from "../src/lib/whatsappTurnRouter.ts";
import { looksLikeOdometerContinuationMessage } from "../src/lib/waraApi.ts";

const tz = "America/Argentina/Buenos_Aires";
let failed = 0;
function assert(cond, label) {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}

console.log("— 'a las 16:55 de hoy' → fecha hoy, no horómetro=16 —");
const fechaHoy = parseFechaFromText("Ahora quiero cambiar el horometro a las 16:55 de hoy", tz) ?? "";
assert(fechaHoy.includes("T16:55"), "parsea 16:55 del mensaje");
assert(fechaHoy.startsWith("2026-07-27"), `fecha es hoy (obtuvo ${fechaHoy.slice(0, 10)})`);

const merged = mergeOdometerFieldExtractions(
  {
    tramite: "horometro",
    mensaje: "Ahora quiero cambiar el horometro a las 16:55 de hoy",
    historial: "Voy a registrar:\nPatente: LWK 7902\nFecha: 21/10/2023 16:55",
    horometerFlowActive: true,
    treatAsBlankFlowStart: false,
    timezone: tz,
  },
  { message: { horometro: 16 }, thread: {} },
  { horometro_horas: 16, fecha_lectura: "2023-10-21T16:55:00", confidence: 0.9 },
);
assert(merged.fechaNaive?.startsWith("2026-07-27"), "fecha del mensaje gana sobre hilo 2023");
assert(
  merged.horometro === undefined,
  "16:55 del mensaje no se confunde con horómetro 16 h",
);

console.log("\n— Corrección 'La fecha es la de hoy' —");
assert(
  looksLikeOdometerPendingDataAmendment("La fecha es la de hoy"),
  "detecta corrección de fecha",
);
const amendFecha = parseFechaFromText("La fecha es la de hoy", tz) ?? "";
assert(amendFecha.startsWith("2026-07-27"), "corrección resuelve hoy");

console.log("\n— '27/07/2026 16 hrs' sigue en odómetro con confirm pendiente —");
const pendingThread =
  "Voy a registrar:\nPatente: LWK 7902\nHorómetro: 16 h\nFecha: 21/10/2023 16:55\nRespondé CONFIRMO.";
assert(
  looksLikeOdometerContinuationMessage("27/07/2026 16 hrs"),
  "fecha numérica continúa trámite",
);
assert(
  classifyTurnExecutor("27/07/2026 16 hrs", pendingThread) === "odometro",
  "router → odometro (no unidades/GPS)",
);

console.log("\n— '16:45 de hoy' NO es horómetro 16.75 h —");
const mergedClock = mergeOdometerFieldExtractions(
  {
    tramite: "horometro",
    mensaje: "16:45 de hoy",
    historial: "Atilio: Perfecto, tomo LWK 7902. ¿Cuál es el nuevo horómetro en horas?",
    horometerFlowActive: true,
    treatAsBlankFlowStart: false,
    timezone: tz,
  },
  { message: {}, thread: {} },
  { horometro_horas: 16.75, fecha_lectura: "2026-07-27T00:00:00", confidence: 0.95 },
);
assert(mergedClock.horometro === undefined, "16:45 de hoy no produce horómetro 16.75");
assert(mergedClock.fechaNaive?.includes("T16:45"), `fecha con 16:45 (obtuve: ${mergedClock.fechaNaive})`);

if (failed > 0) process.exit(1);
console.log("\n✓ Verificación fecha/horómetro OK");

