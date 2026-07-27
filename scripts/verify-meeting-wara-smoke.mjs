#!/usr/bin/env node
/**
 * Smoke de escenarios que Wara suele probar en reunión / demo en vivo.
 * Correr ANTES de la reunión: npx tsx scripts/verify-meeting-wara-smoke.mjs
 */
import { classifyTurnExecutor } from "../src/lib/whatsappTurnRouter.ts";
import { clientSupersedesOdometerConfirmation } from "../src/lib/waraApi.ts";
import { threadHasActiveOdometerFlow, threadAwaitingOdometerKmValue } from "../src/lib/wara.ts";
import { mergeOdometerFieldExtractions } from "../src/lib/odometroHorometroExtract.ts";
import { parseFechaFromText } from "../src/lib/odometroFecha.ts";
import { shouldBypassDirectPlateForFleetLookup } from "../src/lib/waraUnitIntent.ts";

let failed = 0;
function assert(cond, label) {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}

const odoPlateAsk =
  "Atilio: Para registrar el cambio de odómetro necesito la patente de la unidad. ¿Cuál es? (podés usar guiones, ej. AB 006 EX, o decime la marca/nombre)";

console.log("— 1. Listado flota → odómetro → prefijo AD → patente —");
const afterFleet = [
  "Cliente: Pásame la lista de mi flota",
  "Atilio: Tenés 414 unidades registradas",
  "Cliente: Quiero hacer un cambio de odometro",
  odoPlateAsk,
  "Cliente: La q empieza con AD",
].join("\n");
assert(classifyTurnExecutor("La q empieza con AD", afterFleet) === "odometro", "prefijo AD → odometro");
assert(threadHasActiveOdometerFlow(afterFleet), "trámite odómetro activo tras listado flota");
assert(
  classifyTurnExecutor("La Ad 626 UG", afterFleet) === "odometro",
  "patente AD 626 UG → odometro (no GPS)",
);

console.log("\n— 2. Confirmación vieja + reinicio + MYQ —");
const pendingOdo = [
  "Voy a registrar:",
  "Patente: OST 223",
  "Odómetro: 500 km",
  "Respondé CONFIRMO.",
  "Cliente: Quiero hacer un cambio de odometro",
  odoPlateAsk,
].join("\n");
assert(
  clientSupersedesOdometerConfirmation("La q empieza con MYQ", pendingOdo),
  "MYQ supersede confirmación stale",
);
assert(classifyTurnExecutor("La q empieza con MYQ", pendingOdo) === "odometro", "MYQ → odometro");

console.log("\n— 3. Ampliar fecha/hora sobre confirmación pendiente —");
const pendingConfirm =
  "Voy a registrar:\nPatente: AC 574 RB\nOdómetro: 600 km\nRespondé CONFIRMO.";
assert(
  !clientSupersedesOdometerConfirmation(
    "Aun no te dije la hora o el dia del cambio de odometro",
    pendingConfirm,
  ),
  "ampliar hora NO descarta confirmación",
);

console.log("\n— 4. Fecha y hora en prosa —");
const tz = "America/Argentina/Buenos_Aires";
assert(
  (parseFechaFromText("el dia de hoy a las 14:00 Hs", tz) ?? "").includes("T14:00"),
  "a las 14:00 Hs",
);
assert(!!parseFechaFromText("el dia de ayer a las 12:00", tz), "ayer a las 12:00");

console.log("\n— 5. Prefijo MYQ no usa OST del hilo —");
assert(
  shouldBypassDirectPlateForFleetLookup("La q empieza con MYQ", "OST223"),
  "MYQ ignora directPlate OST223",
);

console.log("\n— 6. De la misma unidad —");
const retryThread = [
  odoPlateAsk,
  "Cliente: La Ad 626 UG",
  "Atilio: La unidad AD 626 UG está funcionando normalmente.",
  "Cliente: Quiero hacer un cambio de odometro",
  odoPlateAsk,
].join("\n");
assert(classifyTurnExecutor("De la misma unidad", retryThread) === "odometro", "misma unidad → odometro");

console.log("\n— 7. Horómetro tras odómetro (sin arrastrar km) —");
const merged = mergeOdometerFieldExtractions(
  {
    tramite: "horometro",
    mensaje: "ajuste de horometro",
    historial: "Odómetro 223000 km patente OST223",
    horometerFlowActive: true,
    treatAsBlankFlowStart: true,
    timezone: tz,
  },
  { message: {}, thread: { odometro: 223000, patente: "OST223" } },
  null,
);
assert(merged.odometro === undefined, "horómetro en blanco no arrastra km del hilo");

console.log("\n— 8. Consultas que deben seguir yendo a unidades —");
assert(
  classifyTurnExecutor("como esta la ignicion de AD 626 UG?", "") === "unidades",
  "ignición → unidades",
);
assert(classifyTurnExecutor("Pásame la lista de mi flota", "") === "unidades", "listado flota → unidades");

console.log("\n— 9. Certificado —");
assert(
  classifyTurnExecutor("necesito un certificado de cobertura", "") === "certificados",
  "certificado → certificados",
);

console.log("\n— 10. Km solo numérico tras '¿Cuál es el nuevo odómetro en km?' —");
const afterKmAsk = [
  "Cliente: Quiero cambiar el Odometro",
  odoPlateAsk,
  "Cliente: La q empieza con AD",
  "Cliente: Ad578WX",
  "Atilio: Perfecto, tomo AD 578 WX. ¿Cuál es el nuevo odómetro en km?",
].join("\n");
assert(
  classifyTurnExecutor("97880", afterKmAsk) === "odometro",
  "97880 → odometro (no unidades ni flota)",
);
assert(
  threadAwaitingOdometerKmValue(afterKmAsk),
  "hilo en fase de pedir km",
);

if (failed > 0) {
  console.error(`\n✗ ${failed} fallo(s) — NO ir a reunión sin corregir`);
  process.exit(1);
}
console.log("\n✓ Smoke reunión Wara OK — escenarios críticos en verde");
