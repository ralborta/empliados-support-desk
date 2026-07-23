#!/usr/bin/env node
/**
 * Regresión, bug real producción 2026-07-23: tras proponer una confirmación de
 * odómetro ("Voy a registrar: Patente AC 574 RB, Odómetro 600 km... respondé
 * CONFIRMO"), el cliente escribió "Aun no te dije la hora o el dia del cambio de
 * odometro" (quería AGREGAR el dato, no empezar de cero) y:
 *
 *   1. El bot perdió la patente/km ya propuestos por completo y volvió a pedir la
 *      patente desde cero — porque "Aun no te dije... cambio de odometro" contiene
 *      "cambio de odometro", así que looksLikeOdometerIntentStart la clasifica como
 *      un ARRANQUE de trámite, y cualquier arranque vaciaba el hilo a "" sin mirar si
 *      había una confirmación pendiente.
 *   2. El siguiente mensaje del cliente ("unidad AC 574 RB, kilometro 111111 el dia
 *      de ayer a las 12:00") terminó respondido con el ESTADO GPS/ignición de la
 *      unidad (ejecutor "unidades") en vez de continuar el trámite de odómetro —
 *      porque la propia respuesta del bot pidiendo la patente ("... NECESITO la
 *      patente de la unidad...") quedó en el hilo y activó por error
 *      isOdometerFlowSuperseded (que buscaba "necesito/quiero" en CUALQUIER parte
 *      posterior a "Voy a registrar:", sin distinguir que era el propio bot
 *      continuando el MISMO trámite).
 *
 * Además, el cliente pidió dos mejoras relacionadas:
 *   3. "el dia de ayer a las 12:00" no se parseaba (el parser de fecha solo entendía
 *      dd/mm/aaaa) — ahora reconoce "ayer"/"hoy"/"anteayer" + hora.
 *   4. Si la fecha resultante queda en el FUTURO respecto a "ahora", no corresponde
 *      registrarla en silencio.
 *
 * Uso: npx tsx scripts/verify-odometer-pending-confirm-context.mjs
 */
import {
  hasPendingOdometerConfirmation,
  isOdometerFlowSuperseded,
  looksLikeOdometerIntentStart,
  threadHasActiveOdometerFlow,
} from "../src/lib/wara.ts";
import { classifyTurnExecutor } from "../src/lib/whatsappTurnRouter.ts";
import { isFechaEnFuturo, parseFechaFromText } from "../src/lib/odometroFecha.ts";

let failed = 0;
function assert(cond, label) {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}

const pendingConfirmThread =
  "Voy a registrar:\n• Patente: AC 574 RB\n• Odómetro: 600 km\n\n" +
  "Si está correcto, respondé CONFIRMO para registrarlo en Wara.";
const msg2 = "Aun no te dije la hora o el dia del cambio de odometro";

console.log("— Bug real #1: 'cambio de odometro' con confirmación pendiente no debe tratarse como arranque en blanco —");
assert(
  looksLikeOdometerIntentStart(msg2),
  "'Aun no te dije la hora...' SIGUE clasificando como arranque de trámite (a nivel de detección de intención)",
);
assert(
  hasPendingOdometerConfirmation(pendingConfirmThread),
  "hay una confirmación pendiente en el hilo justo antes de este mensaje (patente AC574RB, 600km)",
);
console.log(
  "  → la ruta de odómetro debe usar esto para NO vaciar el hilo pese a que looksLikeOdometerIntentStart sea true (ver treatAsBlankFlowStart en route.ts)",
);

console.log(
  "\n— Bug real #2: la respuesta del propio bot ('...necesito la patente...') no debe marcar el trámite como abandonado —",
);
const threadAfterBotReaskedPlate = [
  pendingConfirmThread,
  msg2,
  "Para registrar el cambio de odómetro necesito la patente de la unidad. ¿Cuál es? (podés usar guiones, ej. AB 006 EX, o decime la marca/nombre)",
].join("\n");
assert(
  !isOdometerFlowSuperseded(threadAfterBotReaskedPlate),
  "isOdometerFlowSuperseded === false (antes daba true por el 'necesito' del propio bot)",
);
assert(
  threadHasActiveOdometerFlow(threadAfterBotReaskedPlate),
  "threadHasActiveOdometerFlow === true (el trámite sigue activo)",
);
const msg4 = "unidad AC 574 RB, kilometro 111111 el dia de ayer a las 12:00";
assert(
  classifyTurnExecutor(msg4, threadAfterBotReaskedPlate) === "odometro",
  "classifyTurnExecutor enruta a 'odometro' (antes iba a 'unidades' y devolvía el estado GPS)",
);

console.log("\n— Sanity: un pivote REAL a otro trámite sigue detectándose (no se rompe isOdometerFlowSuperseded) —");
const threadPivotToCertificado = [
  pendingConfirmThread,
  "Necesito un certificado de otra unidad",
].join("\n");
assert(
  isOdometerFlowSuperseded(threadPivotToCertificado),
  "isOdometerFlowSuperseded === true cuando el cliente pide algo de OTRO trámite (certificado) después",
);
const threadPivotGeneric = [
  pendingConfirmThread,
  "Listo, registré el cambio para la unidad AC427RB. Odómetro nuevo: 600 km.",
  "Ahora quiero saber cómo agrego un contacto nuevo",
].join("\n");
assert(
  isOdometerFlowSuperseded(threadPivotGeneric) === false,
  "sanity: trámite ya registrado con éxito no bloquea consultas posteriores (comportamiento previo intacto)",
);

console.log("\n— Bug real #3: fecha relativa ('ayer a las 12:00') ahora se parsea —");
const ayer = parseFechaFromText("kilometro 111111 el dia de ayer a las 12:00", "America/Argentina/Buenos_Aires");
assert(!!ayer, "parseFechaFromText detecta una fecha para 'el dia de ayer a las 12:00'");
assert(/T12:00:00$/.test(ayer ?? ""), `la hora extraída es 12:00 (obtuvo: ${ayer})`);
const yesterdayDatePart = ayer?.slice(0, 10);
const todayArg = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
assert(yesterdayDatePart !== todayArg, `la fecha calculada (${yesterdayDatePart}) es distinta a hoy (${todayArg}), no 'ahora' por defecto`);

const hoyConHora = parseFechaFromText("hoy a las 09:15", "America/Argentina/Buenos_Aires");
assert(hoyConHora?.slice(0, 10) === todayArg, `'hoy a las 09:15' resuelve al día de hoy (${todayArg})`);
assert(/T09:15:00$/.test(hoyConHora ?? ""), `'hoy a las 09:15' extrae la hora 09:15 (obtuvo: ${hoyConHora})`);

console.log("\n— Sanity: fechas numéricas explícitas (dd/mm/aaaa) siguen funcionando igual que antes —");
const numerica = parseFechaFromText("Km actual: 210.222 / Hora: 10:35 / Fecha 21/07/26");
assert(numerica === "2026-07-21T10:35:00", `fecha numérica sigue parseando igual (obtuvo: ${numerica})`);

console.log("\n— Bug real #4: fecha futura no debe pasar en silencio —");
assert(
  isFechaEnFuturo("2099-01-01T10:00:00", "America/Argentina/Buenos_Aires"),
  "isFechaEnFuturo === true para una fecha claramente futura (2099)",
);
assert(
  !isFechaEnFuturo("2020-01-01T10:00:00", "America/Argentina/Buenos_Aires"),
  "isFechaEnFuturo === false para una fecha claramente pasada (2020)",
);
assert(!isFechaEnFuturo(""), "isFechaEnFuturo === false con string vacío (no rompe)");

if (failed > 0) {
  console.error(`\n✗ ${failed} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ Verificación de contexto de confirmación pendiente en odómetro OK");
