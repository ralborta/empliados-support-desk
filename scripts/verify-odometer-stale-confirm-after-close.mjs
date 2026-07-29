#!/usr/bin/env node
/**
 * Regresión — Bug real, producción 2026-07-29 (conversación completa de "Raúl A."):
 *
 *   1. Tras completar (o abandonar) un trámite de odómetro ("Voy a registrar: Patente:
 *      AD 427 MC / Odómetro: 125852 km ... respondé CONFIRMO"), el cliente dijo "Ok"
 *      (el bot cerró con "De nada, Raúl. ¿Necesitás algo más?") y después escribió un
 *      pedido NUEVO ("Quiero cambiar iluminación odometro"). En vez de arrancar en
 *      blanco (pedir la patente de cero), el bot resucitó el resumen VIEJO tal cual
 *      ("Voy a registrar: Patente: AD 427 MC / Odómetro: 125852 km...").
 *
 *      Causa: `threadHasPriorOdometerUnitRequest` (en odometro-horometro/route.ts, usada
 *      para decidir si tratar el turno como arranque en blanco) escaneaba TODAS las
 *      líneas del hilo — incluidas las del propio BOT. El prompt del bot ("Para
 *      registrar el cambio de odómetro necesito la patente de la unidad. ¿Cuál es?
 *      (podés usar guiones, ej. AB 006 EX...)") matcheaba looksLikeFleetUnitSearchInput
 *      por la patente de EJEMPLO "AB 006 EX", así que el chequeo daba `true` por texto
 *      del BOT, no del cliente, y bloqueaba el arranque en blanco aunque
 *      isOdometerFlowSuperseded ya hubiese detectado (correctamente) que la conversación
 *      había cerrado ("de nada").
 *
 *      Fix: (a) excluir del escaneo las líneas que son el prompt literal del bot pidiendo
 *      la patente, y (b) si isOdometerFlowSuperseded ya es true, el arranque en blanco
 *      no depende de threadHasPriorOdometerUnitRequest.
 *
 *   2. Ya con el resumen viejo en pantalla, el cliente intentó corregir el valor: "No es
 *      152344". El bot respondió "No hay ninguna unidad en la flota de tu empresa con
 *      patente que empiece con NOES152344" — trató la corrección como si fuera una
 *      búsqueda de patente/prefijo de flota.
 *
 *      Causa: `looksLikePlateOnlyMessage` compacta espacios/puntuación antes de evaluar
 *      si el texto "parece" una patente suelta — "No es 152344" compacta a
 *      "NOES152344" (letras + dígitos), forma indistinguible de una patente vieja mal
 *      separada. Eso hacía que looksLikeFleetUnitSearchInput (y por lo tanto el router)
 *      tratara la corrección como un pedido de búsqueda de flota en vez de una enmienda
 *      del trámite de odómetro/horómetro pendiente.
 *
 *      Fix: looksLikePlateOnlyMessage ahora descarta cualquier texto con el patrón de
 *      negación "no es/era/son/eran/fue/fueron" ANTES de compactarlo. Además,
 *      looksLikeOdometerPendingDataAmendment y looksLikeOdometerContinuationMessage ahora
 *      reconocen explícitamente "no es/era/... <número>" como una corrección de valor
 *      durante el trámite, para que la IA de resolveOdometerHorometerFields (que ya
 *      interpreta bien este caso con el contexto del tramite activo) llegue a ejecutarse.
 *
 * Uso: npx tsx scripts/verify-odometer-stale-confirm-after-close.mjs
 */
import assert from "node:assert";
import {
  isOdometerFlowSuperseded,
  hasPendingOdometerConfirmation,
  looksLikeOdometerIntentStart,
  looksLikeOdometerPendingDataAmendment,
  looksLikeExplicitOdometerUpdateRequest,
  looksLikePlateOnlyMessage,
  detectLoosePlate,
} from "../src/lib/wara.ts";
import {
  looksLikeFleetUnitSearchInput,
  looksLikeUnitNameInMessage,
} from "../src/lib/waraUnitIntent.ts";
import { looksLikeOdometerContinuationMessage } from "../src/lib/waraApi.ts";

let passed = 0;
function check(label, cond) {
  assert.ok(cond, label);
  passed++;
  console.log(`  ✓ ${label}`);
}

// Reimplementación exacta del fix en odometro-horometro/route.ts: excluye las líneas que
// son el prompt literal del bot y agrega el corte por isOdometerFlowSuperseded.
function computeTreatAsBlankFlowStart(rawText, preliminaryThreadText) {
  const odometerFlowStart = looksLikeOdometerIntentStart(rawText);
  const hasUnitHintInCurrentMessage =
    looksLikeFleetUnitSearchInput(rawText) || looksLikeUnitNameInMessage(rawText);
  const hasPendingConfirmInThread = hasPendingOdometerConfirmation(preliminaryThreadText);
  const threadHasPriorOdometerUnitRequest = preliminaryThreadText
    .split("\n")
    .filter((line) => !/^para registrar el cambio de (od[oó]metro|hor[oó]metro)/i.test(line.trim()))
    .some(
      (line) =>
        looksLikeExplicitOdometerUpdateRequest(line) &&
        (looksLikeFleetUnitSearchInput(line) || looksLikeUnitNameInMessage(line)),
    );
  const priorFlowExplicitlySuperseded = isOdometerFlowSuperseded(preliminaryThreadText);
  return (
    odometerFlowStart &&
    !hasUnitHintInCurrentMessage &&
    (priorFlowExplicitlySuperseded ||
      (!hasPendingConfirmInThread && !threadHasPriorOdometerUnitRequest))
  );
}

// --- Reproducción exacta de la conversación real (más viejo primero) ---
const realThread = [
  "Hola Raúl, ¿en qué te puedo ayudar?",
  "Quiero cambiar un odometro",
  "Para registrar el cambio de odómetro necesito la patente de la unidad. ¿Cuál es? (podés usar guiones, ej. AB 006 EX, o decime la marca/nombre)",
  "La patente comienza con Ad",
  "Encontré 68 unidades que empiezan con AD (AD 427 MC, AD 626 UJ, AD 626 UD, AD 626 UH, AD 626 UE, AD 626 UG, AD 578 WX, AD 578 WS). Decime cuál querés consultar (patente exacta).",
  "La AD427Mc",
  "Perfecto, tomo AD 427 MC. ¿Cuál es el nuevo horómetro en horas?",
  "No odometro",
  "Perfecto, tomo AD 427 MC. ¿Cuál es el nuevo horómetro en horas?",
  "en q empresa estoy?",
  "Estás operando con El Cacique S.A.. ¿En qué te puedo ayudar?",
  "quiero cambiar horometro",
  "Para registrar el cambio de horómetro necesito la patente de la unidad. ¿Cuál es? (podés usar guiones, ej. AB 006 EX, o decime la marca/nombre)",
  "no perdon quierocambiar odometro",
  "Perfecto, tomo AD 427 MC. ¿Cuál es el nuevo odómetro en km?",
  "125852",
  "Voy a registrar:\n• Patente: AD 427 MC\n\n\nSi está correcto, respondé CONFIRMO para registrarlo en Wara.",
  "no me equivoque eran 125885",
  "Voy a registrar:\n• Patente: AD 427 MC\n• Horómetro: 125885 h\n\nSi está correcto, respondé CONFIRMO para registrarlo en Wara.",
  "Hola",
  "Hola Raúl, seguimos por acá. ¿Qué necesitás?",
  "Quiero cambien un odometro",
  "Para registrar el cambio respondé CONFIRMO. Si algo no está bien, decime la patente o el valor correcto, o escribí que querés hacer otra gestión.",
  "Ok",
  "De nada, Raúl. ¿Necesitás algo más?",
].join("\n");

console.log("Bug #1: arranque en blanco tras cierre de conversación\n");

check(
  "isOdometerFlowSuperseded detecta el cierre ('de nada') como fin del trámite viejo",
  isOdometerFlowSuperseded(realThread) === true,
);
check(
  "hasPendingOdometerConfirmation es false (no hay confirmación activa real)",
  hasPendingOdometerConfirmation(realThread) === false,
);
check(
  "El prompt propio del bot ('Para registrar el cambio de odómetro...AB 006 EX') matchea " +
    "looksLikeFleetUnitSearchInput por la patente de ejemplo (causa raíz confirmada)",
  looksLikeFleetUnitSearchInput(
    "Para registrar el cambio de odómetro necesito la patente de la unidad. ¿Cuál es? (podés usar guiones, ej. AB 006 EX, o decime la marca/nombre)",
  ) === true,
);
check(
  "Con el fix, 'Quiero cambiar iluminación odometro' SÍ se trata como arranque en blanco " +
    "(no resucita el resumen viejo con 125852 km)",
  computeTreatAsBlankFlowStart("Quiero cambiar iluminación odometro", realThread) === true,
);
check(
  "Un pedido normal de odómetro con confirmación REALMENTE pendiente sigue sin tratarse " +
    "como blanco (no regresiona verify-odometer-confirm-amendment.mjs)",
  computeTreatAsBlankFlowStart(
    "corrijo el odometro",
    [
      "Perfecto, tomo AD 427 MC. ¿Cuál es el nuevo odómetro en km?",
      "125852",
      "Voy a registrar:\n• Patente: AD 427 MC\n• Odómetro: 125852 km\n\nSi está correcto, respondé CONFIRMO para registrarlo en Wara.",
    ].join("\n"),
  ) === false,
);

console.log("\nBug #2: 'No es <número>' corrigiendo el valor propuesto\n");

check(
  "looksLikePlateOnlyMessage ya NO trata 'No es 152344' como patente suelta",
  looksLikePlateOnlyMessage("No es 152344") === false,
);
check(
  "detectLoosePlate ya NO extrae 'NOES152344' de 'No es 152344'",
  detectLoosePlate("No es 152344") === null,
);
check(
  "looksLikeFleetUnitSearchInput ya NO clasifica 'No es 152344' como búsqueda de flota",
  looksLikeFleetUnitSearchInput("No es 152344") === false,
);
check(
  "looksLikeOdometerPendingDataAmendment reconoce 'No es 152344' como corrección de valor",
  looksLikeOdometerPendingDataAmendment("No es 152344") === true,
);
check(
  "looksLikeOdometerContinuationMessage enruta 'No es 152344' al trámite de odómetro",
  looksLikeOdometerContinuationMessage("No es 152344") === true,
);
check(
  "Variantes equivalentes ('no era 199887', 'No, es 45000') también se reconocen",
  looksLikeOdometerPendingDataAmendment("no era 199887") === true &&
    looksLikeOdometerPendingDataAmendment("No, es 45000") === true,
);

console.log("\nSanity checks — no regresionar patentes/nombres de unidad reales\n");

check(
  "'no es esa, es la AD427MC' sigue detectando la patente real dentro de la corrección",
  detectLoosePlate("no es esa, es la AD427MC") === "AD427MC",
);
check(
  "Una patente suelta normal ('AD427MC') sigue reconociéndose",
  looksLikePlateOnlyMessage("AD427MC") === true,
);
check(
  "Un prefijo de flota normal ('NKL') sigue reconociéndose como búsqueda de flota",
  looksLikeFleetUnitSearchInput("NKL") === true,
);
check(
  "Un nombre de unidad ('M600-085') sigue reconociéndose",
  looksLikeUnitNameInMessage("M600-085") === true,
);

console.log(`\n${passed} checks passed.`);
