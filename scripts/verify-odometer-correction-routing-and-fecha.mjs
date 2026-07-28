#!/usr/bin/env node
/**
 * Regresión bug real 2026-07-28 (capturas cliente, unidad AD 626 UD):
 *
 * 1) El fix anterior (looksLikeGenericCorrectionIntent dentro de
 *    odometro-horometro/route.ts) nunca llegaba a ejecutarse: el ROUTER
 *    (classifyTurnExecutor → shouldContinueOdometerFlow →
 *    looksLikeOdometerContinuationMessage) no reconocía "Quiero corregir el
 *    dato"/"Quiero corregir un dato" como continuación del trámite de
 *    odómetro/horómetro (no menciona odómetro/horómetro/patente/fecha
 *    explícitamente), así que el mensaje nunca se enviaba al executor de
 *    odómetro y cae al fallback por defecto ("unidades"), devolviendo el
 *    estado GPS de la unidad activa o una respuesta genérica en vez de
 *    preguntar qué dato corregir.
 *
 * 2) "me equivoque la hora es a las13:05" (corrección de solo la hora, pegada
 *    sin espacio) no la reconocía parseFechaFromText porque el patrón de
 *    "hora suelta" exigía que el mensaje ENTERO fuera solo la hora — el
 *    resumen de confirmación perdía la línea de Fecha por completo en vez de
 *    actualizarla.
 *
 * 3) Corregir CUALQUIER dato (patente, odómetro, horómetro) durante una
 *    confirmación pendiente sin repetir la fecha no debe borrar la fecha ya
 *    confirmada del resumen anterior.
 */
import {
  looksLikeGenericCorrectionIntent,
  looksLikeOdometerPendingDataAmendment,
} from "../src/lib/wara.ts";
import {
  looksLikeOdometerContinuationMessage,
  shouldContinueOdometerFlow,
} from "../src/lib/waraApi.ts";
import { classifyTurnExecutor } from "../src/lib/whatsappTurnRouter.ts";
import { parseFechaFromText } from "../src/lib/odometroFecha.ts";

let failed = 0;
function assert(cond, label) {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}

const threadOdometroConfirm =
  "unidad AD 626 UD\n" +
  "Voy a registrar:\n" +
  "· Patente: AD 626 UD\n" +
  "· Odómetro: 19666 km\n" +
  "· Fecha: 28/07/2026 13:11\n\n" +
  "Si está correcto, respondé CONFIRMO para registrarlo en Wara.";

const threadHorometroConfirm =
  "Voy a registrar:\n" +
  "· Patente: AD 626 UD\n" +
  "· Horómetro: 756 h\n" +
  "· Fecha: 26/07/2026 14:17\n\n" +
  "Si está correcto, respondé CONFIRMO para registrarlo en Wara.";

console.log("— Router: 'corregir el/un dato' durante confirmación pendiente sigue en odómetro —");
for (const msg of ["Quiero corregir el dato", "Quiero corregir un dato", "corregir datos"]) {
  assert(
    looksLikeOdometerContinuationMessage(msg),
    `looksLikeOdometerContinuationMessage("${msg}") = true`,
  );
  assert(
    shouldContinueOdometerFlow(msg, threadOdometroConfirm),
    `shouldContinueOdometerFlow("${msg}") = true con confirmación de odómetro pendiente`,
  );
  assert(
    shouldContinueOdometerFlow(msg, threadHorometroConfirm),
    `shouldContinueOdometerFlow("${msg}") = true con confirmación de horómetro pendiente`,
  );
  const executor = classifyTurnExecutor(msg, threadOdometroConfirm);
  assert(
    executor === "odometro",
    `classifyTurnExecutor("${msg}") = "odometro" (obtuvo "${executor}")`,
  );
}

console.log("\n— No debe romper el default a 'unidades' quando NO hay trámite de odómetro activo —");
assert(
  !looksLikeOdometerContinuationMessage("hola, buenas"),
  "saludo normal sigue sin ser continuación de odómetro",
);
{
  const executor = classifyTurnExecutor("Quiero corregir el dato", "hola, ¿cómo estás?");
  assert(
    executor !== "odometro",
    `sin hilo de odómetro, "Quiero corregir el dato" NO fuerza el executor de odómetro (obtuvo "${executor}")`,
  );
}

console.log("\n— parseFechaFromText: hora corregida dentro de una oración (pegada, sin espacio) —");
const tz = "America/Argentina/Buenos_Aires";
const today = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
for (const msg of [
  "me equivoque la hora es a las13:05",
  "me equivoqué, la hora es a las 13:05",
  "perdon la hora correcta es 13:05",
]) {
  const parsed = parseFechaFromText(msg, tz);
  assert(
    parsed === `${today}T13:05:00`,
    `"${msg}" → ${today}T13:05:00 (obtuvo: ${parsed})`,
  );
}

console.log("\n— No debe introducir falsos positivos en parseFechaFromText —");
assert(parseFechaFromText("168", tz) === undefined, "168 solo sigue sin ser fecha");
assert(parseFechaFromText("168 horas", tz) === undefined, "168 horas sigue sin ser hora del reloj");
assert(
  parseFechaFromText("no hay ninguna fecha acá") === undefined,
  "texto sin fecha sigue devolviendo undefined",
);
assert(
  parseFechaFromText("el odómetro correcto es 12000", tz) === undefined,
  "corrección de odómetro sin fecha/hora sigue sin inventar una fecha",
);

console.log("\n— looksLikeOdometerPendingDataAmendment: la hora sola sigue detectándose como enmienda —");
assert(
  looksLikeOdometerPendingDataAmendment("me equivoque la hora es a las13:05"),
  '"me equivoque la hora es a las13:05" es una enmienda',
);

if (failed > 0) {
  console.error(`\n✗ ${failed} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ Ruteo de corrección de odómetro/horómetro + fecha embebida OK");
