#!/usr/bin/env node
/**
 * Regresión, bug real producción 2026-07-23:
 * "Quiero hacer un cambio de horometro de la unidad M600-026" se misruteaba a
 * consulta GPS/estado (ignición, reporte) en vez del trámite de odómetro/horómetro;
 * y al corregir "te pedi un cambio de horometro" perdía la unidad M600-026.
 */
import { classifyTurnExecutor } from "../src/lib/whatsappTurnRouter.ts";
import { looksLikeLiveUnitConsultIntent } from "../src/lib/waraApi.ts";
import {
  looksLikeExplicitOdometerUpdateRequest,
  looksLikeOdometerFlowReminder,
  looksLikeOdometerIntentStart,
} from "../src/lib/wara.ts";
import {
  looksLikeFleetUnitSearchInput,
  looksLikeUnitNameInMessage,
  resolveUnitQuery,
} from "../src/lib/waraUnitIntent.ts";

let failed = 0;
function assert(cond, label) {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}

const msg1 = "Quiero hacer un cambio de horometro de la unidad M600-026";
const msg2 = "te pedi un cambio de horometro";
const threadAfterMisroute = [
  msg1,
  "La unidad AH 881 VG (M600-026) está detenida, la ignición está apagada...",
  msg2,
].join("\n");

console.log("— Bug #1: cambio de horómetro + unidad NO va a consulta GPS en vivo —");
assert(looksLikeOdometerIntentStart(msg1), "detecta arranque de trámite odómetro/horómetro");
assert(looksLikeExplicitOdometerUpdateRequest(msg1), "es actualización explícita, no consulta");
assert(!looksLikeLiveUnitConsultIntent(msg1), "NO matchea looksLikeLiveUnitConsultIntent (antes sí, por 'quiero'+'unidad')");
assert(classifyTurnExecutor(msg1, "") === "odometro", "classifyTurnExecutor → odometro (no unidades/GPS)");

console.log("\n— Bug #2: nombre interno M600-026 se reconoce como identificador de unidad —");
assert(looksLikeUnitNameInMessage("M600-026"), "looksLikeUnitNameInMessage('M600-026')");
assert(looksLikeUnitNameInMessage(msg1), "looksLikeUnitNameInMessage en el mensaje completo");
assert(looksLikeFleetUnitSearchInput(msg1), "looksLikeFleetUnitSearchInput incluye nombre de unidad");

const fleet = [{ movil_id: 1, patente: "AH881VG", unidad: "M600-026" }];
const resolved = await resolveUnitQuery({ rawText: msg1, threadText: "", units: fleet, preferAi: false });
assert(
  resolved.intent === "consult_status" && resolved.plate === "AH881VG",
  `resolveUnitQuery resuelve M600-026 → AH881VG (obtuvo intent=${resolved.intent} plate=${resolved.plate})`,
);

console.log("\n— Bug #3: corrección 'te pedi un cambio de horometro' mantiene el trámite —");
assert(looksLikeOdometerFlowReminder(msg2), "looksLikeOdometerFlowReminder detecta la corrección");
assert(classifyTurnExecutor(msg2, threadAfterMisroute) === "odometro", "sigue enrutando a odometro");

const resolvedFromThread = await resolveUnitQuery({
  rawText: msg2,
  threadText: threadAfterMisroute,
  units: fleet,
  preferAi: false,
});
assert(
  resolvedFromThread.intent === "consult_status" && resolvedFromThread.plate === "AH881VG",
  `resolveUnitQuery desde hilo recupera M600-026 → AH881VG (obtuvo intent=${resolvedFromThread.intent} plate=${resolvedFromThread.plate})`,
);

console.log("\n— Sanity: consulta GPS real sigue yendo a unidades —");
const gpsMsg = "Quiero ver el estado de la unidad AH 881 VG";
assert(looksLikeLiveUnitConsultIntent(gpsMsg), "consulta de estado real sigue matcheando live consult");
assert(classifyTurnExecutor(gpsMsg, "") === "unidades", "consulta GPS → unidades");

if (failed > 0) {
  console.error(`\n✗ ${failed} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ Verificación de horómetro + M600-026 OK");
