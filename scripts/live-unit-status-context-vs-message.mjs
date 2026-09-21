#!/usr/bin/env node
/**
 * Live: unit_status_read con interno distinto a activeUnit vs reuso de contexto.
 *
 * Caso A: activa AH 492 LU / M900-102 + "Indícame cómo ves la 900118"
 *   → action=unit_status_read, entity=900118, reuse=false
 * Caso B: misma activa + "Indícame cómo está"
 *   → action=unit_status_read, reuse=true
 *
 * Sin OPENAI_API_KEY → NOT_EXECUTED (no se presenta como verde).
 * Uso: npx tsx scripts/live-unit-status-context-vs-message.mjs
 */
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function loadDotEnv() {
  for (const name of [".env.local", ".env"]) {
    const p = resolve(process.cwd(), name);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!m) continue;
      const key = m[1];
      if (process.env[key]?.trim()) continue;
      let val = m[2].trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      process.env[key] = val;
    }
  }
}

loadDotEnv();

const { understandUserUtterance } = await import("../src/lib/utteranceUnderstanding.ts");
const {
  canReuseContextUnitForTurn,
  hasStatusReadMessageUnitEntity,
  movilIdFromMessageUnderStatusRead,
} = await import("../src/lib/unitConsultTurnDecision.ts");

const thread = [
  "Cliente: AH492LU",
  "Atilio: Con la unidad AH 492 LU (M900-102), contame qué problema estás viendo:",
  "¿no reporta ahora, no ves movimiento/recorrido en el historial, ignición, u otra cosa?",
].join("\n");

if (!process.env.OPENAI_API_KEY?.trim()) {
  console.log("LIVE_RESULT=NOT_EXECUTED reason=missing_OPENAI_API_KEY");
  console.log("La suite live no se presenta como evidencia verde.");
  process.exit(0);
}

function evidence(label, understanding, rawText) {
  const action = understanding?.action ?? null;
  const unitRef = understanding?.unitRef ?? null;
  const movilId = movilIdFromMessageUnderStatusRead({
    utteranceAction: action,
    rawText,
  });
  const hasEntity = hasStatusReadMessageUnitEntity({
    utteranceAction: action,
    rawText,
    hasUsableUnitInMessage: movilId != null,
  });
  const reuse = canReuseContextUnitForTurn({
    utteranceAction: action,
    unitRefKind: unitRef?.kind,
    hasUsableUnitInMessage: hasEntity,
    hasPersistedContextUnit: true,
  });
  const row = {
    label,
    action,
    unitRef,
    messageEntity: movilId,
    hasEntity,
    contextReuse: reuse,
    resolvedHint: movilId != null ? `M${String(movilId).replace(/^(\d{3})(\d+)$/, "$1-$2")}` : reuse ? "M900-102 (contexto)" : "ask_unit",
  };
  console.log(`\n[${label}]`, JSON.stringify(row, null, 2));
  console.log(`LLM raw (${label}):`, JSON.stringify(understanding, null, 2));
  return row;
}

const msgA = "Indícame cómo ves la 900118";
const understandingA = await understandUserUtterance(msgA, thread);
assert.ok(understandingA, "LLM debe devolver understanding (caso A)");
const evA = evidence("A-message-entity", understandingA, msgA);

assert.equal(evA.action, "unit_status_read", "A: action=unit_status_read");
assert.equal(evA.messageEntity, 900118, "A: message entity=900118");
assert.equal(evA.contextReuse, false, "A: context reuse=false");
assert.equal(evA.resolvedHint, "M900-118", "A: resolved unit hint M900-118");

const msgB = "Indícame cómo está";
const understandingB = await understandUserUtterance(msgB, thread);
assert.ok(understandingB, "LLM debe devolver understanding (caso B)");
const evB = evidence("B-context-reuse", understandingB, msgB);

assert.equal(evB.action, "unit_status_read", "B: action=unit_status_read");
assert.equal(evB.messageEntity, null, "B: sin entidad en mensaje");
assert.equal(evB.contextReuse, true, "B: context reuse=true → M900-102");

console.log("\nLIVE_RESULT=EXECUTED_OK");
console.log("OK live-unit-status-context-vs-message (cero escrituras externas)");
