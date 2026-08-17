#!/usr/bin/env node
/**
 * Fechas/horas coloquiales en trámite odómetro/horómetro (V1 odometroFecha.ts).
 * Alineado con convenciones de apps/wara-v2 natural-datetime — determinístico, testeable.
 */
import assert from "node:assert/strict";
import {
  fechaLecturaTieneHora,
  formatFechaDisplay,
  getCalendarContext,
  looksLikeClockTimeOnlyMessage,
  mergeFechaConHoraSuelt,
  parseColloquialTimeFromText,
  parseFechaFromText,
} from "../src/lib/odometroFecha.ts";

const tz = "America/Argentina/Buenos_Aires";
const ctx = getCalendarContext(tz);

function check(label, cond) {
  assert.ok(cond, label);
}

console.log("— Horas coloquiales —");
assert.deepEqual(parseColloquialTimeFromText("4 de la tarde"), { hh: "16", min: "00" });
assert.deepEqual(parseColloquialTimeFromText("12 en punto"), { hh: "12", min: "00" });
assert.deepEqual(parseColloquialTimeFromText("a las 8 de la mañana"), { hh: "08", min: "00" });
assert.deepEqual(parseColloquialTimeFromText("tipo seis"), { hh: "18", min: "00" });
assert.deepEqual(parseColloquialTimeFromText("cuatro de la tarde"), { hh: "16", min: "00" });

console.log("— Fechas relativas + hora coloquial —");
const ayerTarde = parseFechaFromText("ayer a las 4 de la tarde", tz);
check("ayer 4 de la tarde → ayer 16:00", ayerTarde?.startsWith(ctx.yesterdayIso) && ayerTarde.includes("T16:00"));
assert.equal(formatFechaDisplay(ayerTarde), `${ctx.yesterdayDisplay} 16:00`);

const jueves = parseFechaFromText("el jueves a las 11:00", tz);
check("el jueves 11:00 tiene hora", fechaLecturaTieneHora(jueves, "el jueves a las 11:00"));
assert.match(formatFechaDisplay(jueves) ?? "", / 11:00$/);

const domingo = parseFechaFromText("11:45 del domingo", tz);
check("11:45 del domingo", domingo?.includes("T11:45"));

const anoche = parseFechaFromText("anoche a las 9", tz);
check("anoche a las 9", anoche?.startsWith(ctx.yesterdayIso) && anoche.includes("T09:00"));

const estaManana = parseFechaFromText("esta mañana a las 6", tz);
check("esta mañana 6", estaManana?.startsWith(ctx.todayIso) && estaManana.includes("T06:00"));

console.log("— Hora suelta tras día pendiente —");
assert.equal(looksLikeClockTimeOnlyMessage("4 de la tarde"), true);
const merged = mergeFechaConHoraSuelt(`${ctx.yesterdayIso}T00:00:00`, "12 en punto", tz);
check("merge ayer + 12 en punto", merged === `${ctx.yesterdayIso}T12:00:00`);

console.log("— Sin hora imprecisa (sigue pidiendo hora) —");
const ayerSolo = parseFechaFromText("ayer", tz);
assert.equal(fechaLecturaTieneHora(ayerSolo, "ayer"), false);

console.log("— Regresión scripts previos —");
assert.equal(parseFechaFromText("kilometro 111111 el dia de ayer a las 12:00", tz)?.includes("T12:00"), true);
assert.equal(parseFechaFromText("me equivoque la hora es a las13:05", tz)?.includes("T13:05"), true);
assert.equal(parseFechaFromText("168 horas", tz), undefined);

console.log("OK verify-odometro-colloquial-datetime");
