#!/usr/bin/env node
/**
 * Live LLM: decisión semántica real debe producir action=unit_status_read.
 * Sin OPENAI_API_KEY → NOT_EXECUTED (no se presenta como verde).
 *
 * Uso: npx tsx scripts/live-gps-overlay-semantic.mjs
 */
import assert from "node:assert/strict";

const {
  shouldInterpretAmbiguousUtterance,
  understandUserUtterance,
  actionRiskFromUnderstanding,
  shouldClarifyUnitWithoutStatusAction,
} = await import("../src/lib/utteranceUnderstanding.ts");
const { decidePendingWriteInterference } = await import("../src/lib/pendingWriteInterference.ts");

const thread = [
  "Cliente: Ok ahora cambio de horometro",
  "Atilio: ⏱ *Horómetro*",
  "",
  "🚗 *Unidad:* NKL 952",
  "",
  "📋 *Datos operativos del horómetro*",
  "Pasame el nuevo horómetro en horas y la fecha/hora de la lectura.",
].join("\n");

assert.equal(shouldInterpretAmbiguousUtterance("Estrado 900121", thread), true);
assert.equal(shouldInterpretAmbiguousUtterance("4521", thread), false);

if (!process.env.OPENAI_API_KEY?.trim()) {
  console.log("LIVE_RESULT=NOT_EXECUTED reason=missing_OPENAI_API_KEY");
  console.log("La suite live no se presenta como evidencia verde.");
  process.exit(0);
}

async function assertStatusReadTypo(text, label) {
  const understanding = await understandUserUtterance(text, thread);
  console.log(`LLM decision (${label}):`, JSON.stringify(understanding, null, 2));
  assert.ok(understanding, `LLM debe devolver understanding para ${label}`);
  assert.equal(
    understanding.action,
    "unit_status_read",
    `${label}: debe declarar action=unit_status_read (no solo vehicle_unit)`,
  );
  const risk = actionRiskFromUnderstanding(understanding);
  assert.equal(risk, "read", `${label}: riesgo derivado del action estructurado`);
  assert.equal(shouldClarifyUnitWithoutStatusAction(understanding), false);
  const interference = decidePendingWriteInterference({
    hasPendingWrite: true,
    incomingActionRisk: risk,
    incomingMatchesExpectedField: false,
  });
  assert.equal(interference, "overlay_read_keep_pending");
}

// Caso de prueba (no instrucción privilegiada del prompt): typo "estrado".
await assertStatusReadTypo("Estrado 900121", "estrado");
// Typo NO mencionado en el prompt — comprueba generalización.
await assertStatusReadTypo("Estdo 900100", "estdo-generalizacion");

// Contraste: referencia sola no debe ser read
const refOnly = {
  referent: "vehicle_unit",
  confidence: 0.9,
  clarifyQuestion: null,
  action: "unit_reference",
  unitRef: { kind: "unit_name", value: "900121" },
};
assert.equal(actionRiskFromUnderstanding(refOnly), null);

console.log("LIVE_RESULT=EXECUTED_OK");
console.log("OK live-gps-overlay-semantic (cero escrituras externas)");
