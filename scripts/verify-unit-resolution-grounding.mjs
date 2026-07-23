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
} from "../src/lib/waraUnitIntent.ts";

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

if (failed > 0) {
  console.error(`\n✗ ${failed} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ Verificación de grounding de resolución de unidades OK (sin loop por marca inexistente)");
