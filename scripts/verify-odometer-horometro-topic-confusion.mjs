#!/usr/bin/env node
/**
 * Regresión — Bug real, producción 2026-07-29:
 *   1. "Quiero cambiar un odometro" → tras resolver la patente (AD 427 MC), el bot
 *      terminó preguntando "¿Cuál es el nuevo horómetro en horas?" en vez de odómetro.
 *      Causa: `horometerFlowActive` usaba `mentionsHorometroIntent(flowThreadText)`, un
 *      chequeo SIN acotar sobre los últimos 48 mensajes del ticket — una mención vieja
 *      de "horómetro" de un trámite ya resuelto (minutos/horas antes, en la misma
 *      conversación) contaminaba un pedido nuevo de odómetro sin relación.
 *   2. Al intentar corregir ("No odometro"), el bot repitió TEXTUALMENTE la misma
 *      pregunta de horómetro — no dejaba corregir ni salir del loop.
 *
 * Fix: horometerFlowActive ahora usa threadAwaitingHorometerPlate/KmValue (ya acotadas a
 * los últimos ~2500 caracteres y al prompt EXACTO que mandó el bot, no cualquier mención
 * vieja de la palabra), y una mención EXPLÍCITA del campo en el mensaje ACTUAL
 * (rawText) tiene prioridad sobre cualquier señal del hilo — permite corregir en
 * cualquier momento ("No, odómetro" / "es odómetro no horómetro").
 *
 * Este test reimplementa la fórmula exacta de horometerFlowActive/wantsHorometro con las
 * funciones reales exportadas, sin DB (misma técnica que verify-active-unit-memory.mjs).
 *
 * Uso: npx tsx scripts/verify-odometer-horometro-topic-confusion.mjs
 */
import assert from "node:assert";
import {
  looksLikeHorometerOnlyIntent,
  threadAwaitingHorometerPlate,
  threadAwaitingHorometerKmValue,
  threadAwaitingOdometerPlate,
  threadAwaitingOdometerKmValue,
} from "../src/lib/wara.ts";

let passed = 0;
function check(label, cond) {
  assert.ok(cond, label);
  passed++;
  console.log(`  ✓ ${label}`);
}

// Reimplementación exacta del fix en odometro-horometro/route.ts (incluye el desempate
// por recencia de lastAwaitingFieldPromptInTail, ver comentario ahí sobre el bug real de
// producción 2026-07-29 donde una pregunta VIEJA de horómetro y una NUEVA de odómetro
// convivían en el mismo tail de ~2500 caracteres).
function lastAwaitingFieldPromptInTail(threadText) {
  const tail = threadText
    .slice(-2500)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const horoIdx = Math.max(
    tail.lastIndexOf("para registrar el cambio de horometro necesito la patente"),
    tail.lastIndexOf("cual es el nuevo horometro en horas"),
    tail.lastIndexOf("cuantas horas de motor"),
  );
  const odoIdx = Math.max(
    tail.lastIndexOf("para registrar el cambio de odometro necesito la patente"),
    tail.lastIndexOf("cual es el nuevo odometro en km"),
    tail.lastIndexOf("cual es el nuevo valor de odometro"),
  );
  if (horoIdx < 0 && odoIdx < 0) return null;
  return horoIdx > odoIdx ? "horometro" : "odometro";
}

function computeHorometerFlowActive(rawText, threadText) {
  const rawExplicitlyMentionsOdometroOnly =
    /\bod[oó]metro\b/i.test(rawText) && !/\bhor[oó]metro\b/i.test(rawText);
  if (rawExplicitlyMentionsOdometroOnly) return false;
  const horometerAwaitingInThread =
    threadAwaitingHorometerPlate(threadText) || threadAwaitingHorometerKmValue(threadText);
  const odometerAwaitingInThread =
    threadAwaitingOdometerPlate(threadText) || threadAwaitingOdometerKmValue(threadText);
  return (
    looksLikeHorometerOnlyIntent(rawText) ||
    (horometerAwaitingInThread &&
      !(odometerAwaitingInThread && lastAwaitingFieldPromptInTail(threadText) === "odometro"))
  );
}

console.log("▶ Bug real #1: mención VIEJA de horómetro (trámite ya resuelto) no debe contaminar un pedido nuevo de odómetro");
const staleHorometroHistory = [
  // Trámite de horómetro completado hace rato, en la MISMA conversación (48 mensajes de
  // ticket, sin cortar). Nada de esto es "hilo activo" para el pedido de HOY.
  "Quiero cambiar un horometro",
  "Para registrar el cambio de horómetro necesito la patente de la unidad. ¿Cuál es?",
  "OST 223",
  "Perfecto, tomo OST 223. ¿Cuál es el nuevo horómetro en horas?",
  "450",
  "Listo, registré el cambio para la unidad OST223.",
  // ... conversación sigue con otros temas sin relación ...
  "Gracias, ¿algo más?",
  "De nada. ¿Necesitás algo más?",
].join("\n");
check(
  '"La AD427Mc" (sin mencionar odómetro/horómetro) con hilo viejo de horómetro → NO activa horómetro',
  !computeHorometerFlowActive("La AD427Mc", staleHorometroHistory),
);
check(
  '"quiero cambiar un odometro" (arranque explícito) con hilo viejo de horómetro → NO activa horómetro',
  !computeHorometerFlowActive("quiero cambiar un odometro", staleHorometroHistory),
);

console.log("\n▶ Bug real #2: el cliente debe poder corregir el campo en cualquier momento, sin loop");
const botAskedHorometroByMistake = [
  "Quiero cambiar un odometro",
  "Para registrar el cambio de odómetro necesito la patente de la unidad. ¿Cuál es?",
  "La patente comienza con Ad",
  "Encontré 68 unidades que empiezan con AD. Decime cuál querés consultar (patente exacta).",
  "La AD427Mc",
  "Perfecto, tomo AD 427 MC. ¿Cuál es el nuevo horómetro en horas?",
].join("\n");
check(
  '"No odometro" (corrección explícita) SIEMPRE gana, aunque el hilo diga horómetro',
  !computeHorometerFlowActive("No odometro", botAskedHorometroByMistake),
);
check(
  '"quiero corregir, es odometro" también corrige',
  !computeHorometerFlowActive("quiero corregir, es odometro", botAskedHorometroByMistake),
);
check(
  '"No, horometro" (el cliente SÍ confirma horómetro) sigue reconociéndolo',
  computeHorometerFlowActive("no, horometro", botAskedHorometroByMistake),
);

console.log("\n▶ Sanity: un trámite de horómetro REAL y activo sigue funcionando igual (sin regresión)");
const activeHorometroThread = [
  "Quiero cambiar un horometro",
  "Para registrar el cambio de horómetro necesito la patente de la unidad. ¿Cuál es?",
  "OST 223",
  "Perfecto, tomo OST 223. ¿Cuál es el nuevo horómetro en horas?",
].join("\n");
check(
  '"450" (respuesta numérica pura, sin mencionar el campo) sigue reconociendo el trámite de horómetro activo',
  computeHorometerFlowActive("450", activeHorometroThread),
);
check(
  '"quiero cambiar un horometro" (arranque explícito de horómetro) sigue funcionando',
  computeHorometerFlowActive("quiero cambiar un horometro", ""),
);

console.log(
  "\n▶ Bug real #3: pregunta VIEJA de horómetro y pregunta NUEVA de odómetro conviven en el mismo tail (~2500 chars) tras una corrección — gana la más reciente",
);
const staleHorometroThenFreshOdometro = [
  "Quiero cambiar un odometro",
  "Para registrar el cambio de odómetro necesito la patente de la unidad. ¿Cuál es?",
  "La patente comienza con Ad",
  "Encontré 68 unidades que empiezan con AD. Decime cuál querés consultar (patente exacta).",
  "La AD427Mc",
  "Perfecto, tomo AD 427 MC. ¿Cuál es el nuevo horómetro en horas?", // pregunta vieja (bug ya corregido en otro turno)
  "no perdon quierocambiar odometro",
  "Perfecto, tomo AD 427 MC. ¿Cuál es el nuevo odómetro en km?", // pregunta nueva y correcta, MÁS RECIENTE
].join("\n");
check(
  '"125852" (valor puro) con AMBAS preguntas en el tail → gana la más reciente (odómetro)',
  !computeHorometerFlowActive("125852", staleHorometroThenFreshOdometro),
);
check(
  "lastAwaitingFieldPromptInTail detecta 'odometro' como la más reciente en ese mismo tail",
  lastAwaitingFieldPromptInTail(staleHorometroThenFreshOdometro) === "odometro",
);

console.log("\n▶ Sanity: un trámite de odómetro real y activo (sin ninguna mención de horómetro) sigue pidiendo km");
const activeOdometroThread = [
  "Quiero cambiar un odometro",
  "Para registrar el cambio de odómetro necesito la patente de la unidad. ¿Cuál es?",
  "AD 427 MC",
  "Perfecto, tomo AD 427 MC. ¿Cuál es el nuevo odómetro en km?",
].join("\n");
check(
  '"97880" (respuesta numérica) NO activa horómetro en un trámite de odómetro real',
  !computeHorometerFlowActive("97880", activeOdometroThread),
);

if (passed < 1) {
  console.error("\n✗ 0 checks corrieron");
  process.exit(1);
}
console.log(`\n✓ ${passed} checks OK — verify-odometer-horometro-topic-confusion`);
