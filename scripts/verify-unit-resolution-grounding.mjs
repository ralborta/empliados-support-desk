#!/usr/bin/env node
/**
 * Regresión del bug real (producción, 2026-07-22): el bot repetía TEXTUALMENTE la
 * misma clarificación ("¿Podés confirmar la patente? Opciones: OST 223, AD 427 MC.")
 * turno tras turno cuando el cliente pedía una unidad ("Saveiro") que no existe en
 * su flota real, incluso rechazando explícitamente las opciones ofrecidas.
 *
 * Causa raíz: el prompt de la IA incluye el historial de la conversación (donde
 * queda su propia respuesta anterior), y cuando el término pedido no tiene ninguna
 * coincidencia real de texto en la flota, el reconciliador confiaba igual en los
 * candidatos "anclados" que devolvía la IA. Este test simula justo esa respuesta de
 * IA ficticia (sin llamar a OpenAI) contra `reconcileAiClarification`, para verificar
 * que ahora se corta el loop con un mensaje de "no encontrado" en vez de repetir.
 *
 * Uso: npx tsx scripts/verify-unit-resolution-grounding.mjs
 */
import {
  reconcileAiClarification,
  filterAiCandidatesByFleetTerms,
  buildCustomerOnlyText,
  resolveUnitQuery,
  buildFleetUnitNotFoundMessage,
} from "../src/lib/waraUnitIntent.ts";
import { extractPlateCorrectionHint, extractPlatePrefixFromMessage } from "../src/lib/wara.ts";

let failed = 0;
function assert(cond, label) {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${label}`);
  }
}

// Flota real del caso: tiene OST 223 y AD 427 MC, pero ninguna Saveiro.
const fleetNoSaveiro = [
  { movil_id: 1, patente: "OST 223", unidad: "900-041" },
  { movil_id: 2, patente: "AD 427 MC", unidad: "CAMION 1" },
];

console.log("— Loop real: marca inexistente en flota (Saveiro) —");

// Turno 1: "No es la Saveiro". La IA (ficticia) repite lo que ya dijo antes en el
// historial: OST 223 y AD 427 MC. Ninguna tiene "saveiro" en patente/unidad.
const aiTurn1 = {
  intent: "need_clarification",
  plate: undefined,
  searchTerms: [],
  candidatePlates: ["OST223", "AD427MC"],
  clarificationQuestion: "¿Podés confirmar la patente? Opciones: OST 223, AD 427 MC.",
  source: "ai",
};
const turn1 = reconcileAiClarification(aiTurn1, "No es la Saveiro", fleetNoSaveiro);
assert(turn1.intent === "need_clarification", "turno 1: sigue pidiendo aclaración");
assert(
  turn1.candidatePlates.length === 0,
  "turno 1: no repite candidatos ajenos al pedido (OST223/AD427MC)",
);
assert(
  !(turn1.clarificationQuestion ?? "").includes("OST 223") &&
    !(turn1.clarificationQuestion ?? "").includes("AD 427 MC"),
  "turno 1: el mensaje ya NO repite las opciones OST 223 / AD 427 MC",
);

// Turno 2: "Ninguna de esas es la Saveiro" — el cliente rechaza explícitamente las
// opciones. La IA (ficticia) vuelve a devolver lo mismo (anclada en el historial).
const aiTurn2 = { ...aiTurn1 };
const turn2 = reconcileAiClarification(aiTurn2, "Ninguna de esas es la Saveiro", fleetNoSaveiro);
assert(turn2.intent === "need_clarification", "turno 2: sigue pidiendo aclaración");
assert(
  turn2.candidatePlates.length === 0,
  "turno 2: tampoco repite OST223/AD427MC tras el rechazo explícito",
);
assert(
  !(turn2.clarificationQuestion ?? "").includes("OST 223") &&
    !(turn2.clarificationQuestion ?? "").includes("AD 427 MC"),
  "turno 2: el mensaje de turno 2 sigue sin repetir las opciones rechazadas",
);

console.log("— Marca real en flota: la IA grounded sigue funcionando —");

// Sanity check: si la IA propone una patente que SÍ es real y coincide con el
// término pedido, debe resolver directo (no debe romperse por el fix de arriba).
const fleetWithNissan = [
  { movil_id: 1, patente: "OST 223", unidad: "900-041" },
  { movil_id: 2, patente: "AD 427 MC", unidad: "CAMION 1" },
  { movil_id: 3, patente: "AH 562 SP", unidad: "NISSAN FRONTIER" },
];
const aiNissan = {
  intent: "need_clarification",
  searchTerms: [],
  candidatePlates: ["AH562SP"],
  clarificationQuestion: "¿Es la AH 562 SP?",
  source: "ai",
};
const nissanResolved = reconcileAiClarification(aiNissan, "Nissan", fleetWithNissan);
assert(
  nissanResolved.intent === "consult_status" && nissanResolved.plate === "AH562SP",
  "Nissan real en flota → resuelve directo (no se rompe con el fix)",
);

// Sanity check adicional a nivel de la función de filtrado.
assert(
  filterAiCandidatesByFleetTerms("No es la Saveiro", fleetNoSaveiro, ["OST223", "AD427MC"]).length === 0,
  "filterAiCandidatesByFleetTerms descarta candidatos no anclados a la flota",
);
assert(
  filterAiCandidatesByFleetTerms("Nissan", fleetWithNissan, ["AH562SP"]).length === 1,
  "filterAiCandidatesByFleetTerms mantiene candidatos grounded",
);

console.log("— Historial de la IA no incluye respuestas del propio bot —");

// Endurecimiento adicional: el "historial" que ve la IA para buscar por marca/nombre
// no debe incluir lo que el propio bot respondió antes (para no anclarse ahí), solo
// lo que escribió el cliente. Las reglas (threadText completo) no se ven afectadas.
const mixedThread = [
  { direction: "INBOUND", text: "Tengo problemas con el odometro" },
  { direction: "OUTBOUND", text: "Ya existe un caso abierto (N° 2107264) para este reclamo." },
  { direction: "INBOUND", text: "Pero es para otra patente" },
  { direction: "OUTBOUND", text: "Perfecto, tomo OST 223. ¿Cuál es el nuevo odómetro en km?" },
  { direction: "INBOUND", text: "No es la Saveiro" },
  { direction: "OUTBOUND", text: "¿Podés confirmar la patente? Opciones: OST 223, AD 427 MC." },
];
const customerOnly = buildCustomerOnlyText(mixedThread);
assert(
  customerOnly.includes("Tengo problemas con el odometro") &&
    customerOnly.includes("Pero es para otra patente") &&
    customerOnly.includes("No es la Saveiro"),
  "historial solo-cliente conserva los mensajes del cliente",
);
assert(
  !customerOnly.includes("OST 223") &&
    !customerOnly.includes("AD 427 MC") &&
    !customerOnly.includes("Ya existe un caso abierto"),
  "historial solo-cliente descarta las respuestas previas del bot (evita el anclaje)",
);

console.log("— Marca/nombre: catálogo real primero, en CUALQUIER trámite —");

// Antes, la búsqueda por marca/nombre priorizaba reglas contra el catálogo real
// solo en certificados (certificateContext). Ahora aplica siempre: si hay una sola
// unidad real que coincide, resuelve directo sin pasar por la IA.
const nissanNoCertContext = await resolveUnitQuery({
  rawText: "Nissan",
  threadText: "",
  units: fleetWithNissan,
  // sin certificateContext ni preferAi: simula odómetro/mantenimiento/unidades general
});
assert(
  nissanNoCertContext.intent === "consult_status" &&
    nissanNoCertContext.plate === "AH562SP" &&
    nissanNoCertContext.source === "rules",
  "Nissan sin certificateContext también resuelve directo por catálogo real (no solo en certificados)",
);

console.log("— Queja genérica sin patente/marca no dice \"no encontré esa unidad\" —");

// Bug real (producción, 2026-07-22): "tengo problemas con una unidad" no menciona
// ninguna patente/prefijo/marca — no se buscó nada todavía. Antes, esto terminaba
// filtrando la flota por palabras sueltas de la frase ("problemas", "con", "una") y
// respondía "No encontré esa unidad en la flota", como si hubiese rechazado una
// patente concreta que el cliente nunca dio. Debe pedir el dato, no decir "no está".
const fleetAny = [
  { movil_id: 1, patente: "OST 223", unidad: "900-041" },
  { movil_id: 2, patente: "AD 427 MC", unidad: "CAMION 1" },
];
const genericComplaint = await resolveUnitQuery({
  rawText: "tenmgo problemas con una unidad",
  threadText: "",
  units: fleetAny,
});
assert(
  genericComplaint.intent === "need_clarification",
  "queja genérica → pide aclaración (no resuelve una patente al azar)",
);
assert(
  (genericComplaint.clarificationQuestion ?? "") === buildFleetUnitNotFoundMessage({}),
  "queja genérica → usa el mensaje neutro de \"pedir identificador\"",
);
assert(
  !(genericComplaint.clarificationQuestion ?? "").toLowerCase().includes("no encontré"),
  "queja genérica → el mensaje NO dice \"no encontré esa unidad\" (nunca se buscó nada concreto)",
);

console.log("— Código de unidad tipo \"300-092\"/\"M300-093\" que NO está en la flota —");

// Bug real, producción 2026-07-23: "300-092" y "M300-093" (formato nombre de unidad,
// como el propio bot sugiere de ejemplo: "M300-111") SÍ generan términos de búsqueda
// reales (tokenizeSearchTerms → ["300","092"] / ["m300","093"]), a diferencia de la
// queja genérica de arriba. Pero como ninguna unidad de la flota coincidía, se
// respondía con el MISMO "¿Cuál unidad?" genérico que si el cliente no hubiese
// escrito nada — confuso, porque el cliente sí dio un dato concreto, dos veces.
const codeNotInFleet = await resolveUnitQuery({
  rawText: "300-092",
  threadText: "",
  units: fleetAny,
});
assert(
  codeNotInFleet.intent === "need_clarification",
  "código que no está en la flota → pide aclaración (no rompe ni inventa una unidad)",
);
assert(
  (codeNotInFleet.clarificationQuestion ?? "").toLowerCase().includes("300-092"),
  "código que no está en la flota → el mensaje SÍ reconoce lo que se buscó (no dice '¿Cuál unidad?' genérico)",
);
assert(
  (codeNotInFleet.clarificationQuestion ?? "").toLowerCase().includes("no encontré"),
  "código que no está en la flota → dice explícitamente que no lo encontró (a diferencia de la queja sin datos)",
);

console.log("— Marca real + relleno conversacional no listado en STOPWORDS —");

// Bug real encontrado en auditoría (2026-07-23): la búsqueda por marca/nombre exigía
// que TODAS las palabras no-stopword matchearan (AND) contra patente+unidad. Es
// imposible enumerar en STOPWORDS todas las palabras de relleno de una queja en
// español ("pasa", "onda", "anda", etc. — mismo patrón de listas cerradas que las
// conjugaciones de "ayudar"). "que pasa con la saveiro" no resolvía porque "pasa" no
// aparece en ningún patente/unidad, aunque "saveiro" sí. Ahora se descartan primero
// los términos que no aparecen en NINGUNA unidad de la flota antes de exigir el AND.
const fleetWithSaveiro = [
  { movil_id: 1, patente: "AD 427 MC", unidad: "FORD RANGER" },
  { movil_id: 2, patente: "LWK 891", unidad: "VOLKSWAGEN SAVEIRO" },
];
for (const [text, label] of [
  ["que pasa con la saveiro", "'que pasa con la saveiro'"],
  ["que onda con la saveiro", "'que onda con la saveiro'"],
  ["hola que tal como anda la saveiro", "'hola que tal como anda la saveiro'"],
]) {
  const resolved = await resolveUnitQuery({ rawText: text, threadText: "", units: fleetWithSaveiro });
  assert(
    resolved.intent === "consult_status" && resolved.plate === "LWK891",
    `${label} → resuelve la Saveiro real a pesar del relleno conversacional`,
  );
}

console.log("— \"La unidad mencionada\" reusa la patente ya resuelta en el hilo (no dice 'empiece con UNIDAD') —");

// Bug real (producción, 2026-07-23): tras resolver "la nissan" → AG 562 SP y reportar
// su estado, el cliente pidió "dame el certificado de la unidad mencionada". Dos bugs
// encadenados causaban una respuesta absurda ("No hay ninguna unidad... con patente
// que empiece con UNIDAD"):
//   1) extractPlateCorrectionHint matcheaba "de la <palabra>" y devolvía "UNIDAD"
//      (palabra genérica de vocabulario de flota) como si fuera un dato útil.
//   2) looksLikeVagueUnitReference no reconocía "la unidad mencionada"/"dicha unidad"
//      como referencia al contexto, así que nunca se reusaba la última patente real
//      del hilo (AG 562 SP) — quedaba código muerto por un `?? ""` que nunca fallaba.
assert(
  !extractPlateCorrectionHint("dame el certificado de la unidad mencionada"),
  "'unidad mencionada' no es un hint de patente válido (palabra genérica de flota)",
);
assert(
  !extractPlatePrefixFromMessage("dame el certificado de la unidad mencionada"),
  "'unidad mencionada' tampoco es un prefijo de patente válido",
);

const fleetNissan = [
  { movil_id: 1, patente: "AG 562 SP", unidad: "NISSAN 2404" },
  { movil_id: 2, patente: "OST 223", unidad: "CAMION 1" },
];
const threadAfterNissanResolved = [
  "La unidad es la nissan",
  "La unidad AG 562 SP (NISSAN 2404 - AG 562 SP) presenta una falla de ignición. El reporte y la posición están actualizados, pero la ignición está apagada desde hace cinco horas. He generado el caso N° 35784 para Atención al Cliente.",
  "Puede ser que la unidad este detenidos por qué dejo de trabajar hace 4 horas",
  "La unidad AG 562 SP (NISSAN 2404 - AG 562 SP) presenta una falla de ignición. El reporte y la posición están actualizados, pero la ignición está apagada desde hace cinco horas. He generado el caso N° 35784 para Atención al Cliente.",
].join("\n");

for (const [text, label] of [
  ["Bien entendido, dame el certificado de la unidad mencionada", "'la unidad mencionada'"],
  ["dame el certificado de esa unidad", "'esa unidad'"],
  ["dame el certificado de dicha unidad", "'dicha unidad'"],
]) {
  const resolved = await resolveUnitQuery({
    rawText: text,
    threadText: threadAfterNissanResolved,
    units: fleetNissan,
    certificateContext: true,
  });
  assert(
    resolved.intent === "consult_status" && resolved.plate === "AG562SP",
    `${label} → reusa AG562SP (la unidad ya resuelta en el hilo), no pide una patente que "empiece con UNIDAD"`,
  );
}

if (failed > 0) {
  console.error(`\n✗ ${failed} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ Verificación de grounding de resolución de unidades OK (sin loop por marca inexistente)");
