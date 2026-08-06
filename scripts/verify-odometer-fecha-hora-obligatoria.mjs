#!/usr/bin/env node
/**
 * Pedido Emma/Wara 2026-08-06: en cambio de odómetro son obligatorios
 * km + fecha + hora. Al tomar la unidad se piden JUNTOS (no solo km).
 * No asumir "hoy/ahora" en silencio ni CONFIRMO sin hora.
 *
 * Bug real 2026-08-06: tras "necesito la fecha y hora…" el cliente mandó
 * "Hora: 14:14 fecha 05/07/26" → typing eterno (superseded falso → unidades).
 *
 * Uso: npx tsx scripts/verify-odometer-fecha-hora-obligatoria.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  fechaLecturaTieneHora,
  formatFechaDisplay,
  getCalendarContext,
  looksLikeAhoraComoFechaLectura,
  mergeFechaConHoraSuelt,
  parseFechaFromText,
} from "../src/lib/odometroFecha.ts";
import {
  isOdometerFlowSuperseded,
  threadAwaitingOdometerConfirmDetails,
  threadAwaitingOdometerKmValue,
  threadHasActiveOdometerFlow,
} from "../src/lib/wara.ts";
import { shouldRouteTurnToOdometerExecutor } from "../src/lib/waraUnitIntent.ts";

const tz = "America/Argentina/Buenos_Aires";
const here = dirname(fileURLToPath(import.meta.url));

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

// Caso captura WhatsApp 2026-08-06: hora y fecha en una línea, orden invertido.
const capturaMsg = "Hora: 14:14 fecha 05/07/26";
const capturaParsed = parseFechaFromText(capturaMsg, tz);
assert.equal(
  capturaParsed,
  "2026-07-05T14:14:00",
  `parse «Hora: … fecha …» (obtuve: ${capturaParsed})`,
);
assert.equal(fechaLecturaTieneHora(capturaParsed, capturaMsg), true);

const askThread =
  "Tomé AA 251 VD (10500 km). Para registrar el cambio necesito la fecha y hora de la lectura (ej. 05/08/26 a las 14:30). Si fue recién, respondé «ahora».";
assert.equal(
  threadAwaitingOdometerConfirmDetails(askThread),
  true,
  "pedido de fecha/hora mantiene trámite activo",
);
assert.equal(
  isOdometerFlowSuperseded(askThread),
  false,
  "«necesito la fecha y hora» NO abandona el trámite",
);

const hangThread = [
  "Cliente: Me corregis el odometro de la nissan?",
  "Atilio: Perfecto, tomo AG 562 SP. ¿Cuál es el nuevo odómetro en km?",
  "Cliente: 10500",
  `Atilio: ${askThread.replace("AA 251 VD", "AG 562 SP")}`,
].join("\n");
assert.equal(isOdometerFlowSuperseded(hangThread), false, "hilo captura no superseded");
assert.equal(threadHasActiveOdometerFlow(hangThread), true, "flujo activo tras pedir fecha/hora");
assert.equal(
  shouldRouteTurnToOdometerExecutor({
    selectionText: capturaMsg,
    threadText: hangThread,
  }),
  true,
  "ruta a odometro sin pending (hilo pide fecha/hora)",
);
assert.equal(
  shouldRouteTurnToOdometerExecutor({
    selectionText: capturaMsg,
    threadText: hangThread,
    pendingActionType: "odometro",
  }),
  true,
  "ruta a odometro con pending",
);

// Al tomar unidad: plantilla pide km + fecha + hora juntos.
const routeSrc = readFileSync(
  join(here, "../src/app/api/wara/odometro-horometro/route.ts"),
  "utf8",
);
assert.match(
  routeSrc,
  /Pasame el nuevo od[oó]metro en km y la fecha y hora de la lectura/,
  "plantilla pide km+fecha+hora al tomar unidad",
);
assert.match(
  routeSrc,
  /Me falta la fecha y hora de la lectura/,
  "si faltan fecha/hora las vuelve a pedir",
);
assert.doesNotMatch(
  routeSrc,
  /Sin fecha y hora no registro/,
  "sin frase de amenaza «sin fecha no registro»",
);
assert.doesNotMatch(
  routeSrc,
  /Si fue recién: el km y la palabra/,
  "no ofrece «ahora» en el pedido inicial (feedback Wara)",
);
assert.doesNotMatch(
  routeSrc,
  /Perfecto, tomo \$\{plateDisplay\}\. ¿Cuál es el nuevo odómetro en km\?/,
  "ya no pide solo el km",
);

const askAllThread =
  "Perfecto, tomo AG 562 SP. Pasame el nuevo odómetro en km y la fecha y hora de la lectura (ej. 10500 km — 05/08/26 a las 14:30).";
assert.equal(
  threadAwaitingOdometerKmValue(askAllThread),
  true,
  "pedido conjunto sigue en espera de valor",
);

// Relativas: hoy/ayer/lunes → fecha concreta DD/MM/AAAA (nunca solo la palabra).
const ctx = getCalendarContext(tz);
const hoy = parseFechaFromText("hoy a las 14:30", tz);
assert.ok(hoy?.startsWith(ctx.todayIso), "hoy → día de hoy");
assert.equal(formatFechaDisplay(hoy), `${ctx.todayDisplay} 14:30`);
const ayer = parseFechaFromText("ayer a las 19:00", tz);
assert.ok(ayer?.startsWith(ctx.yesterdayIso), "ayer → día de ayer");
assert.equal(formatFechaDisplay(ayer), `${ctx.yesterdayDisplay} 19:00`);
const lunes = parseFechaFromText("el lunes a las 11:00", tz);
assert.ok(lunes && fechaLecturaTieneHora(lunes, "el lunes a las 11:00"), "lunes+hora OK");
assert.match(formatFechaDisplay(lunes) ?? "", /^\d{2}\/\d{2}\/\d{4} 11:00$/);
const martes = parseFechaFromText("martes 16:45", tz);
assert.ok(martes && fechaLecturaTieneHora(martes, "martes 16:45"), "martes+hora OK");
assert.match(formatFechaDisplay(martes) ?? "", /^\d{2}\/\d{2}\/\d{4} 16:45$/);
assert.equal(
  fechaLecturaTieneHora(parseFechaFromText("ayer", tz), "ayer"),
  false,
  "ayer sin hora → insiste pidiendo hora",
);

console.log("OK — km+fecha+hora obligatorias; hoy/ayer/lunes con fecha concreta; sin hang");
