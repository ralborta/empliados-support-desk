#!/usr/bin/env node
/**
 * Regresión, bug real producción 2026-07-23 (ticket cmrv1v4400001jy04xmjdmet1):
 * el cliente mandó "Km actual: 210.222 / Hora: 10:35 / Fecha 21/07/26" (plantilla de
 * respuesta rápida, 3 líneas separadas) y:
 *
 *   1) La hora ("10:35") se perdía: `parseFechaFromText` solo capturaba hora si venía
 *      pegada a la fecha en el mismo match, así que quedaba en 00:00.
 *   2) Aun capturando la hora bien, `fechaWara` reinterpretaba el string "naive" como
 *      UTC (server corre en UTC) y lo volvía a convertir a hora Argentina — un doble
 *      corrimiento de zona horaria que hacía que "10:35" terminara registrado "07:35".
 *   3) El resumen de confirmación ("Voy a registrar: ...") nunca mostraba la fecha/hora,
 *      así que el cliente no tenía forma de verificar el dato ANTES de confirmar — de
 *      ahí que preguntara después "¿se registró como te la pedí?" sin que el bot
 *      pudiera contestarle.
 */
import { fechaWara, formatFechaDisplay, parseFechaFromText } from "../src/lib/odometroFecha.ts";

let failed = 0;
function assert(cond, label) {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${label}`);
  }
}

console.log("— Hora en línea separada de la fecha (plantilla real de WhatsApp) —");

const threadReal = "Km actual: 210.222\nHora: 10:35\nFecha 21/07/26";
const parsed = parseFechaFromText(threadReal);
assert(parsed === "2026-07-21T10:35:00", `parseFechaFromText captura hora separada de la fecha (obtuve: ${parsed})`);

console.log("— Fecha+hora pegadas en el mismo texto sigue funcionando igual que antes —");

assert(
  parseFechaFromText("Lo cambié el 21/07/2026 10:35") === "2026-07-21T10:35:00",
  "fecha y hora pegadas en el mismo match siguen resolviendo igual",
);
assert(
  parseFechaFromText("Lo cambié el 21/07/26") === "2026-07-21T00:00:00",
  "solo fecha sin ninguna hora en el texto sigue devolviendo 00:00 (sin inventar dato)",
);
assert(parseFechaFromText("no hay ninguna fecha acá") === undefined, "sin fecha en el texto → undefined");

console.log("— No hay doble corrimiento de zona horaria (bug real: 10:35 → 07:35) —");

for (const tzEnv of [undefined, "UTC", "America/Argentina/Buenos_Aires"]) {
  const prevTz = process.env.TZ;
  if (tzEnv) process.env.TZ = tzEnv;
  const fecha = fechaWara("2026-07-21T10:35:00", "America/Argentina/Buenos_Aires");
  assert(
    fecha === "2026-07-21T10:35:00",
    `fechaWara no reconvierte un valor "naive" ya en hora local (TZ proceso=${tzEnv ?? "sin forzar"}, obtuve: ${fecha})`,
  );
  process.env.TZ = prevTz;
}

console.log("— Valor con zona horaria explícita SÍ se convierte —");

const withOffset = fechaWara("2026-07-21T13:35:00Z", "America/Argentina/Buenos_Aires");
assert(
  withOffset === "2026-07-21T10:35:00",
  `un valor con "Z" explícito sigue convirtiéndose a la zona del cliente (obtuve: ${withOffset})`,
);

console.log("— Sin valor explícito, usa la fecha/hora actual en la zona del cliente —");

const now = fechaWara(undefined, "America/Argentina/Buenos_Aires");
assert(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(now), `fechaWara() sin valor devuelve fecha/hora actual válida (obtuve: ${now})`);

console.log("— formatFechaDisplay para mostrarle al cliente —");

assert(formatFechaDisplay("2026-07-21T10:35:00") === "21/07/2026 10:35", "formatea para mostrar al cliente");
assert(formatFechaDisplay(undefined) === null, "sin fecha → null (no rompe el resumen)");
assert(formatFechaDisplay("") === null, "fecha vacía → null");

if (failed > 0) {
  console.error(`\n✗ ${failed} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ Verificación de fecha/hora del trámite de odómetro OK");
