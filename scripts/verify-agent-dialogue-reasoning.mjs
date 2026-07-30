#!/usr/bin/env node
/**
 * Regresión — consulta unidad MYQ 693: el agente debe razonar con dialogue_state,
 * no repetir plantillas ni re-ofrecer ticket cuando el caso ya está abierto.
 *
 * Uso: npx tsx scripts/verify-agent-dialogue-reasoning.mjs
 */
import assert from "node:assert";
import {
  looksLikeUnitConsultFollowUp,
  threadHasRecentUnitCaseOpened,
  threadHasRecentNoEquipmentExplanation,
} from "../src/lib/waraApi.ts";
import {
  buildNoEquipmentDialogueState,
  detectUnitConsultQuestion,
  formatUnitShortLabel,
} from "../src/lib/unitDialogueState.ts";
import { parseExecutorDialogueState } from "../src/lib/executorDialogueState.ts";

let passed = 0;
function check(label, cond) {
  assert.ok(cond, label);
  passed++;
  console.log(`  ✓ ${label}`);
}

const unit = {
  patente: "MYQ693",
  unidad: "(Baja) M600-009",
  movil_id: 1,
};

console.log("— Etiqueta corta (no bloque nombre+largo) —");
check('formatUnitShortLabel → "MYQ 693"', formatUnitShortLabel(unit) === "MYQ 693");

console.log("\n— Follow-ups conversacionales —");
for (const text of [
  "hace cuanto no reporta?",
  "ah ok entonces ya no funciona verdad??",
  "no registra",
  "y entonces?",
]) {
  check(`follow-up: "${text.slice(0, 30)}"`, looksLikeUnitConsultFollowUp(text) === true);
}

console.log("\n— Detección de pregunta concreta —");
check('"hace cuanto" → hace_cuanto_no_reporta', detectUnitConsultQuestion("hace cuanto no reporta?") === "hace_cuanto_no_reporta");
check('"verdad" → confirmacion_diagnostico', detectUnitConsultQuestion("ah ok entonces ya no funciona verdad??") === "confirmacion_diagnostico");
check('"no registra" → sintoma_no_reporta', detectUnitConsultQuestion("no registra") === "sintoma_no_reporta");

console.log("\n— Hilo con caso ya abierto —");
const threadCaseOpen =
  "La unidad MYQ 693 está registrada en Wara pero no tiene equipo GPS instalado. Generé un caso para Atención al cliente.";
check("threadHasRecentUnitCaseOpened", threadHasRecentUnitCaseOpened(threadCaseOpen) === true);
check("threadHasRecentNoEquipmentExplanation", threadHasRecentNoEquipmentExplanation(threadCaseOpen) === true);

console.log("\n— dialogue_state sin equipo: hace cuánto —");
const dsHaceCuanto = buildNoEquipmentDialogueState({
  unit,
  rawText: "hace cuanto no reporta?",
  casoAbierto: true,
  ticketRef: "TK-123",
  ticketReused: true,
});
check("fase hace_cuanto", dsHaceCuanto.fase === "sin_equipo_hace_cuanto");
check("caso_abierto=true", dsHaceCuanto.caso_abierto === true);
check("prohibido incluye cables", dsHaceCuanto.prohibido?.some((p) => /cables/.test(p)) === true);
check("prohibido incluye otro ticket", dsHaceCuanto.prohibido?.some((p) => /otro ticket/.test(p)) === true);
check(
  "hechos explican sin telemetría",
  dsHaceCuanto.hechos.some((h) => /telemetr/i.test(h)) === true,
);

console.log("\n— dialogue_state confirmación —");
const dsConfirm = buildNoEquipmentDialogueState({
  unit,
  rawText: "ah ok entonces ya no funciona verdad??",
  casoAbierto: true,
  ticketReused: true,
});
check("fase confirmacion", dsConfirm.fase === "sin_equipo_confirmacion");
check("no re-ofrece ticket en prohibido", dsConfirm.prohibido?.some((p) => /otro ticket/.test(p)) === true);

console.log("\n— parseExecutorDialogueState —");
const parsed = parseExecutorDialogueState({
  dialogue_state: dsHaceCuanto,
  agent_compose_s: "true",
});
check("parse devuelve hechos", parsed?.hechos.length === dsHaceCuanto.hechos.length);

console.log(`\n✅ ${passed} checks pasaron.`);
