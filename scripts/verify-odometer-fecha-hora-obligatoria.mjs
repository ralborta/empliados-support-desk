#!/usr/bin/env node
/**
 * Pedido Emma/Wara 2026-08-06: en cambio de odómetro son obligatorios
 * km + fecha + hora. No asumir "hoy/ahora" en silencio ni CONFIRMO sin hora.
 *
 * Uso: npx tsx scripts/verify-odometer-fecha-hora-obligatoria.mjs
 */
import assert from "node:assert/strict";
import {
  fechaLecturaTieneHora,
  looksLikeAhoraComoFechaLectura,
  mergeFechaConHoraSuelt,
  parseFechaFromText,
} from "../src/lib/odometroFecha.ts";
import { threadAwaitingOdometerConfirmDetails } from "../src/lib/wara.ts";

const tz = "America/Argentina/Buenos_Aires";

assert.equal(fechaLecturaTieneHora(undefined), false);
assert.equal(fechaLecturaTieneHora("2026-08-05T00:00:00"), false, "solo fecha sin hora");
assert.equal(
  fechaLecturaTieneHora("2026-08-05T00:00:00", "05/08/26 00:00"),
  true,
  "medianoche explícita cuenta",
);
assert.equal(fechaLecturaTieneHora("2026-08-05T14:30:00"), true);

assert.equal(looksLikeAhoraComoFechaLectura("ahora"), true);
assert.equal(looksLikeAhoraComoFechaLectura("Ahora."), true);
assert.equal(looksLikeAhoraComoFechaLectura("es ahora"), true);
assert.equal(looksLikeAhoraComoFechaLectura("ahora quiero cambiar el odometro"), false);
assert.equal(looksLikeAhoraComoFechaLectura("ahora necesito corregir el odometro"), false);

const soloKm = parseFechaFromText("10500", tz);
assert.equal(soloKm, undefined, "solo km no es fecha");

const soloFecha = parseFechaFromText("05/08/26", tz);
assert.ok(soloFecha?.endsWith("T00:00:00"), "fecha sola → 00:00");
assert.equal(fechaLecturaTieneHora(soloFecha, "05/08/26"), false);

const fechaHora = parseFechaFromText("05/08/26 a las 14:30", tz);
assert.ok(fechaHora?.includes("T14:30"), fechaHora);
assert.equal(fechaLecturaTieneHora(fechaHora, "05/08/26 a las 14:30"), true);

const merged = mergeFechaConHoraSuelt("2026-08-05T00:00:00", "14:30", tz);
assert.equal(merged, "2026-08-05T14:30:00", "hora suelta conserva el día pendiente");

const askThread =
  "Tomé AA 251 VD (10500 km). Para registrar el cambio necesito la fecha y hora de la lectura (ej. 05/08/26 a las 14:30). Si fue recién, respondé «ahora».";
assert.equal(
  threadAwaitingOdometerConfirmDetails(askThread),
  true,
  "pedido de fecha/hora mantiene trámite activo",
);

console.log("OK — fecha+hora obligatorias; «ahora» explícito; km solo no alcanza");
