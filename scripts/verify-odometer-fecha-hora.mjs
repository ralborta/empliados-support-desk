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
import { fechaWara, formatFechaDisplay, parseFechaFromText, fechaLocalNaiveToWaraUtc } from "../src/lib/odometroFecha.ts";

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

console.log("— Fecha antes de Hora + sufijo Hs (plantilla horómetro, bug 2026-07-27) —");

const horoTemplate =
  "Patente: AD 427 MC\nFecha: 26/07/26\nHora: 16:16Hs\nHorometro real: 168HS";
const parsedHoro = parseFechaFromText(horoTemplate);
assert(
  parsedHoro === "2026-07-26T16:16:00",
  `fecha antes de hora con Hs (obtuve: ${parsedHoro})`,
);
assert(
  parseFechaFromText("Fecha: 26/07/26\nHora: 16:16") === "2026-07-26T16:16:00",
  "fecha antes de hora sin sufijo Hs",
);
assert(
  parseFechaFromText("Hora: 16:16Hs\nFecha: 26/07/26") === "2026-07-26T16:16:00",
  "hora con Hs antes de fecha",
);

console.log("— Hora bare con 'hs' (sin etiqueta Hora:/a las) — bug real 2026-08-05 —");

const emiTemplate = "AG 562 SP\n99000 Km\n10:10 hs\n05/08/26";
const parsedEmi = parseFechaFromText(emiTemplate);
assert(
  parsedEmi === "2026-08-05T10:10:00",
  `plantilla "10:10 hs" + fecha (obtuve: ${parsedEmi})`,
);
assert(
  parseFechaFromText("AG 562 SP\n99000 Km\nHora: 10:10 hs\n05/08/26") === "2026-08-05T10:10:00",
  "misma plantilla con etiqueta Hora: sigue OK",
);
assert(
  parseFechaFromText("99000 Km\n10:10\n05/08/26") === "2026-08-05T10:10:00",
  "HH:MM bare cerca de la fecha también se toma",
);
assert(
  parseFechaFromText("99000 Km\n05/08/26") === "2026-08-05T00:00:00",
  "solo fecha sin hora sigue en 00:00 (no inventa)",
);

// No hardcodear la fecha "de hoy": el test corría a la medianoche (AR) y quedaba
// desfasado un día apenas cambiaba el reloj. Se calcula igual que odometroFecha.ts
// (Intl.DateTimeFormat en la zona del cliente) en vez de un string fijo.
const tz = "America/Argentina/Buenos_Aires";
function todayInTz(timezone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const pick = (t) => parts.find((p) => p.type === t)?.value ?? "";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}
const today = todayInTz(tz);

console.log("— '16:45 de hoy' (hora de lectura, no horómetro decimal) —");
const deHoy = parseFechaFromText("16:45 de hoy", tz);
assert(deHoy?.includes("T16:45"), `16:45 de hoy → hora 16:45 (obtuve: ${deHoy})`);
assert(deHoy?.startsWith(today), `16:45 de hoy → fecha hoy (obtuve: ${deHoy?.slice(0, 10)})`);

console.log("— Solo hora, sin fecha → hoy a esa hora —");
for (const sample of ["16:45", "a las 16:45", "Hora: 16:45", "16:45 hs"]) {
  const parsedBare = parseFechaFromText(sample, tz);
  assert(parsedBare?.includes("T16:45"), `"${sample}" → 16:45 (obtuve: ${parsedBare})`);
  assert(parsedBare?.startsWith(today), `"${sample}" → fecha hoy`);
}
assert(parseFechaFromText("168", tz) === undefined, "168 solo no es fecha");
assert(parseFechaFromText("168 horas", tz) === undefined, "168 horas no es hora del reloj");

console.log("\n— Fecha numérica + \"a las HH:MM\" en prosa (bug 2026-07-27) —");

const prosaReal =
  "el kilometraje es 25566, la fecha de lectura el dia 21/07/26 a las 14:00 Hs";
const parsedProsa = parseFechaFromText(prosaReal);
assert(
  parsedProsa === "2026-07-21T14:00:00",
  `fecha con "a las" en la misma oración (obtuve: ${parsedProsa})`,
);

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

console.log("— API Wara: hora local AR → UTC (bug 2026-08-07: 09:43 → no 06:43) —");

const localLectura = "2026-08-07T09:43:00";
const utcParaWara = fechaLocalNaiveToWaraUtc(localLectura, "America/Argentina/Buenos_Aires");
assert(
  utcParaWara === "2026-08-07T12:43:00",
  `09:43 AR → 12:43 UTC (obtuve: ${utcParaWara})`,
);
assert(
  formatFechaDisplay(localLectura) === "07/08/2026 09:43",
  "al cliente se sigue mostrando la hora local 09:43",
);
assert(
  fechaWara(`${utcParaWara}Z`, "America/Argentina/Buenos_Aires") === localLectura,
  "12:43 UTC mostrado en AR vuelve a 09:43",
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
