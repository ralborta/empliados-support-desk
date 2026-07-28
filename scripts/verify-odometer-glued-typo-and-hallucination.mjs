#!/usr/bin/env node
/**
 * Regresión del bug real (producción, 2026-07-28): conversación completa donde el bot
 * "pierde el hilo" al final de un trámite de horómetro. Dos causas de fondo distintas,
 * en cadena:
 *
 * 1) "cambio de horometroa a la q empieza con MYQ" (typing rápido en celular, sin espacio
 *    entre "horometro" y la palabra siguiente) no matcheaba \bhor[oó]metro\b — el mensaje
 *    se ruteaba como consulta de GPS/estado en vez de arrancar el trámite de horómetro.
 *    Como el trámite nunca queda "activo", los 2 mensajes siguientes también se
 *    interpretan mal (siguen devolviendo estado de ignición en vez de continuar el
 *    horómetro).
 *
 * 2) Cuando por fin el trámite arranca ("quiero cambiar el horometro", sin typo), el
 *    resumen final tomó "OST 223" (la primera opción que el propio bot había listado)
 *    en vez de "OST 224" (la unidad que el cliente realmente eligió y sobre la que el
 *    bot ya había respondido) — mismo patrón que el bug histórico de
 *    verify-odometer-plate-continuity.mjs, pero en un punto del código que ese fix no
 *    llegó a cubrir. Además, el mensaje no tenía NINGÚN número, y aun así la IA devolvió
 *    "Horómetro: 4 h" — tomado del "4" de "Encontré 4 unidades..." del historial.
 *
 * Uso: npx tsx scripts/verify-odometer-glued-typo-and-hallucination.mjs
 */
import {
  looksLikeExplicitOdometerUpdateRequest,
  looksLikeHorometerOnlyIntent,
  detectPlate,
  extractLastPlateFromThread,
} from "../src/lib/wara.ts";
import { classifyTurnExecutor } from "../src/lib/whatsappTurnRouter.ts";
import { mergeOdometerFieldExtractions } from "../src/lib/odometroHorometroExtract.ts";

let failed = 0;
function assert(cond, label) {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}

console.log("— Fix 1: typo sin espacio pegado a la palabra clave —");
assert(
  looksLikeExplicitOdometerUpdateRequest("cambio de horometroa a la q empieza con MYQ"),
  "'horometroa' (sin espacio) se reconoce como pedido de horómetro",
);
assert(
  looksLikeHorometerOnlyIntent("cambio de horometroa a la q empieza con MYQ"),
  "'horometroa' se reconoce como horómetro (no odómetro)",
);
assert(
  looksLikeExplicitOdometerUpdateRequest("cambio de horometro a la q empieza con MYQ"),
  "sigue funcionando con el espacio correcto (no regresión)",
);
assert(
  !looksLikeExplicitOdometerUpdateRequest("mira que lindo el auto"),
  "no matchea texto sin ninguna palabra clave (no regresión, sin falso positivo)",
);

console.log("\n— Fix 1: el ruteo arranca el trámite de horómetro, no consulta GPS —");
assert(
  classifyTurnExecutor("cambio de horometroa a la q empieza con MYQ", "") === "odometro",
  "ruteo con typo pegado va a 'odometro', no a 'unidades'",
);

console.log("\n— Fix 2: patente del hilo = última elegida, no la primera listada —");
const threadConCandidatos = [
  "Encontré 4 unidades que empiezan con OST (OST 223, OST 226, OST 224, OST 225). Decime cuál querés consultar (patente exacta).",
  "la OST224",
  "La unidad OST 224 (M300-088) presenta una falla de ignición. El reporte y la posición están actualizadas, pero la ignición está apagada desde hace varias horas. He generado el caso Nº 36050 para que el equipo de Atención al Cliente pueda asistir con este inconveniente.",
].join("\n");
assert(
  detectPlate(threadConCandidatos) === "OST223",
  "detectPlate confirma el bug: devuelve OST223 (la primera opción listada, no la elegida)",
);
assert(
  extractLastPlateFromThread(threadConCandidatos) === "OST224",
  "extractLastPlateFromThread resuelve OST224 (la unidad realmente elegida), no OST223",
);

console.log("\n— Fix 3: sin dígitos en el mensaje actual, no se usa el número 'adivinado' por la IA —");
const sinDigitos = mergeOdometerFieldExtractions(
  {
    tramite: "horometro",
    mensaje: "quiero cambiar el horometro",
    historial: "Encontré 4 unidades que empiezan con OST (OST 223, OST 226, OST 224, OST 225).",
    horometerFlowActive: false,
    treatAsBlankFlowStart: false,
    timezone: "America/Argentina/Buenos_Aires",
  },
  { message: {}, thread: { patente: "OST224" } },
  { patente: "OST223", odometro_km: null, horometro_horas: 4, fecha_lectura: null, confidence: 0.8 },
);
assert(
  sinDigitos.horometro === undefined,
  `mensaje sin dígitos ignora el horómetro inventado por la IA (obtuvo ${sinDigitos.horometro})`,
);

console.log("\n— Fix 3 (no regresión): con un número real en el mensaje, la IA se sigue usando —");
const conDigitos = mergeOdometerFieldExtractions(
  {
    tramite: "horometro",
    mensaje: "el horometro marca 168 horas",
    historial: "",
    horometerFlowActive: false,
    treatAsBlankFlowStart: false,
    timezone: "America/Argentina/Buenos_Aires",
  },
  { message: {}, thread: {} },
  { patente: null, odometro_km: null, horometro_horas: 168, fecha_lectura: null, confidence: 0.9 },
);
assert(
  conDigitos.horometro === 168,
  `mensaje con dígitos sigue usando el valor de la IA cuando corresponde (obtuvo ${conDigitos.horometro})`,
);

if (failed > 0) {
  console.error(`\n✗ ${failed} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ Verificación typo pegado + patente de candidatos + alucinación de IA OK");
