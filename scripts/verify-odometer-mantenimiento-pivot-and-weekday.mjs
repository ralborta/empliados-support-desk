#!/usr/bin/env node
/**
 * Regresión del bug real (producción, 2026-07-28, ticket real reconstruido desde la DB):
 * conversación de horómetro que "pierde el hilo" tras pivotar a mantenimiento, más dos
 * gaps de parseo de fecha.
 *
 * Hilo real (resumido, hora Argentina):
 *   03:57 "Voy a registrar: Patente OST 223 / Horómetro 4h... respondé CONFIRMO" (nunca
 *         se confirmó ni se rechazó explícitamente)
 *   03:59:54 Bot: "Puedo ayudarte con mantenimiento por acá: decime la patente..."
 *   04:00:13 Cliente: "la misma patente" → bot repitió el recordatorio de CONFIRMO del
 *         horómetro viejo en vez de seguir mantenimiento (BUG).
 *   04:01:09 Cliente: "11:45 del domingo" → el bot ignoró "del domingo" (BUG, día de la
 *         semana no soportado) y además revirtió la patente ya tomada (OST224 → OST223)
 *         porque hasPendingOdometerConfirmation seguía "true" para siempre.
 *   04:01:44 Cliente: "la fecha es de hace 2 dias" → tampoco se entendía (BUG).
 *   04:01:47 Bot: "Voy a registrar: Patente MYQ 693 / Horómetro 223h" — patente y
 *         horómetro fantasma, tomados de la unidad activa vieja (una consulta de GPS
 *         de 5 minutos antes) porque el trámite nunca actualizaba la unidad activa en
 *         sus pasos intermedios.
 *
 * Causas de fondo corregidas:
 * 1) isOdometerFlowSuperseded no reconocía un pivote a mantenimiento como fin del
 *    trámite de horómetro (sí reconocía certificado/listado/etc., pero no mantenimiento).
 * 2) parseFechaFromText no entendía día de la semana ("domingo") ni "hace N días".
 * 3) La unidad activa (activeUnit) solo se actualizaba al completar el registro con
 *    éxito, nunca en los pasos intermedios (pidiendo patente/horas).
 *
 * Uso: npx tsx scripts/verify-odometer-mantenimiento-pivot-and-weekday.mjs
 */
import {
  isOdometerFlowSuperseded,
  hasPendingOdometerConfirmation,
  threadHasActiveOdometerFlow,
} from "../src/lib/wara.ts";
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

const tz = "America/Argentina/Buenos_Aires";

console.log("— Fix 1: pivote a mantenimiento cierra el trámite de horómetro pendiente —");
const threadConMantenimiento = [
  "Voy a registrar:\n• Patente: OST 223\n• Horómetro: 4 h\n\nSi está correcto, respondé CONFIRMO para registrarlo en Wara.",
  "quiero cambiar el horometro",
  "Para registrar el cambio de horómetro necesito la patente de la unidad. ¿Cuál es? (podés usar guiones, ej. AB 006 EX, o decime la marca/nombre)",
  "de esa unidfad",
  "Para registrar el cambio respondé CONFIRMO. Si algo no está bien, decime la patente o el valor correcto, o escribí que querés hacer otra gestión.",
  "me podes ayudar a agendar un mantenimiento?",
  "Puedo ayudarte con mantenimiento por acá: decime la patente de la unidad y si es preventivo o correctivo. Si preferís hacerlo vos en Wara, entrá a Utilidades → Mantenimiento.",
].join("\n");
assert(
  isOdometerFlowSuperseded(threadConMantenimiento),
  "isOdometerFlowSuperseded reconoce el pivote a mantenimiento",
);
assert(
  !hasPendingOdometerConfirmation(threadConMantenimiento),
  "la confirmación de horómetro vieja ya no queda 'colgada' para siempre",
);
assert(
  !threadHasActiveOdometerFlow(threadConMantenimiento),
  "el trámite de horómetro ya no se considera activo tras el pivote",
);

console.log("\n— No regresión: sin pivote a mantenimiento, el trámite sigue activo —");
const threadSinPivote = [
  "Voy a registrar:\n• Patente: OST 223\n• Horómetro: 4 h\n\nSi está correcto, respondé CONFIRMO para registrarlo en Wara.",
].join("\n");
assert(
  hasPendingOdometerConfirmation(threadSinPivote),
  "sin pivote real, la confirmación pendiente sigue vigente (no regresión)",
);

console.log("\n— Fix 2: 'del domingo' resuelve al domingo pasado, no a hoy —");
const fechaDomingo = parseFechaFromText("11:45 del domingo", tz);
assert(fechaDomingo != null, "se extrae una fecha (no undefined)");
if (fechaDomingo) {
  const [datePart, timePart] = fechaDomingo.split("T");
  assert(timePart?.startsWith("11:45"), `hora correcta (obtuvo ${timePart})`);
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
  const hoyDow = new Date(`${hoy}T12:00:00Z`).getUTCDay();
  const deltaEsperado = hoyDow; // domingo = 0, así que delta = hoyDow
  const esperado = new Date(`${hoy}T12:00:00Z`);
  esperado.setUTCDate(esperado.getUTCDate() - deltaEsperado);
  const esperadoStr = esperado.toISOString().slice(0, 10);
  assert(datePart === esperadoStr, `fecha = domingo pasado (esperado ${esperadoStr}, obtuvo ${datePart}, NO hoy=${hoy})`);
  assert(datePart !== hoy, "la fecha NO es la de hoy (bug real: se ignoraba 'del domingo')");
}

console.log("\n— Fix 2: 'hace 2 dias' resuelve a 2 días atrás —");
const fechaHaceDias = parseFechaFromText("la fecha es de hace 2 dias", tz);
assert(fechaHaceDias != null, "se extrae una fecha (no undefined)");
if (fechaHaceDias) {
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
  const esperado = new Date(`${hoy}T12:00:00Z`);
  esperado.setUTCDate(esperado.getUTCDate() - 2);
  const esperadoStr = esperado.toISOString().slice(0, 10);
  assert(
    fechaHaceDias.startsWith(esperadoStr),
    `fecha = hoy - 2 días (esperado ${esperadoStr}, obtuvo ${fechaHaceDias})`,
  );
}

console.log("\n— No regresión: 'ayer'/'hoy'/'anteayer' y fechas numéricas siguen igual —");
assert(parseFechaFromText("hoy", tz) != null, "'hoy' sigue funcionando");
assert(parseFechaFromText("ayer a las 14:00", tz)?.includes("T14:00"), "'ayer a las 14:00' sigue funcionando");
assert(
  parseFechaFromText("21/07/2026 10:35", tz) === "2026-07-21T10:35:00",
  "fecha numérica explícita sigue funcionando",
);

if (failed > 0) {
  console.error(`\n✗ ${failed} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ Verificación pivote a mantenimiento + fecha por día de semana / 'hace N días' OK");
