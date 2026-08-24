#!/usr/bin/env node
/**
 * Decisión estructurada V1: estado vs síntomas + reuso de unidad persistida.
 *
 * Aceptación (NO matchers): "misma unidad" / "cómo ves" = casos de prueba vía
 * UtteranceAction + contexto persistido (activeUnit/unitFocus).
 * Sin extractLastPlateFromThread ni forceTelemetry paralelo.
 */
import assert from "node:assert/strict";
import {
  canReuseContextUnitForTurn,
  decideUnitConsultMode,
  isUnitStatusReadAction,
} from "../src/lib/unitConsultTurnDecision.ts";
import { resolveConversationalUnitTurn } from "../src/lib/waraApi.ts";

const listenThread =
  "Cliente: 300089\n" +
  "Atilio: Con OST 225 (M300-089), contame qué problema estás viendo: " +
  "¿no reporta ahora, no ves movimiento/recorrido en el historial, ignición, u otra cosa?";

const gpsExplainedThread =
  "Atilio: El estado GPS de la unidad OST 225 es el siguiente:\n" +
  "📍 Estado GPS\nLa unidad está detenida. Ignición está apagada. Funcionamiento normal.\n" +
  "Por el momento no se generará un ticket.";

console.log("— Ambiguity: unit_status_read sin unidad ni estado persistido → ask_unit —");
assert.equal(
  decideUnitConsultMode({
    utteranceAction: "unit_status_read",
    unitRefKind: "none",
    hasUsableUnitInMessage: false,
    hasPersistedContextUnit: false,
    listenCandidate: true,
  }),
  "ask_unit",
);

console.log("— Persistido + unit_status_read → telemetry (listenCandidate no manda) —");
assert.equal(
  decideUnitConsultMode({
    utteranceAction: "unit_status_read",
    unitRefKind: "none",
    hasUsableUnitInMessage: false,
    hasPersistedContextUnit: true,
    listenCandidate: true,
  }),
  "telemetry",
);
assert.equal(
  canReuseContextUnitForTurn({
    utteranceAction: "unit_status_read",
    unitRefKind: "none",
    hasUsableUnitInMessage: false,
    hasPersistedContextUnit: true,
  }),
  true,
);

console.log("— Reuso solo con acción estructurada + unit_ref.none —");
for (const action of /** @type {const} */ (["unit_status_read", "unit_reference", "continue_field"])) {
  assert.equal(
    canReuseContextUnitForTurn({
      utteranceAction: action,
      unitRefKind: "none",
      hasUsableUnitInMessage: false,
      hasPersistedContextUnit: true,
    }),
    true,
  );
}
assert.equal(
  canReuseContextUnitForTurn({
    utteranceAction: "none",
    unitRefKind: "none",
    hasUsableUnitInMessage: false,
    hasPersistedContextUnit: true,
  }),
  false,
);

console.log("— Autoridad única: utteranceAction unit_status_read (no flag paralelo) —");
assert.equal(isUnitStatusReadAction("unit_status_read"), true);
assert.equal(isUnitStatusReadAction("unit_reference"), false);
assert.equal(
  resolveConversationalUnitTurn({
    rawText: "Indícamelo vos. Cómo ves la 300-089?",
    threadText: listenThread,
    unitLabel: "OST 225",
    utteranceAction: "unit_status_read",
  }),
  null,
  "unit_status_read → no menú (limpia residual)",
);

console.log("— Reiteración post-menú: segundo unit_status_read → telemetría —");
assert.equal(
  resolveConversationalUnitTurn({
    rawText: "quiero el estado",
    threadText: listenThread,
    unitLabel: "OST 225",
    utteranceAction: "unit_status_read",
  }),
  null,
);

assert.equal(
  decideUnitConsultMode({
    utteranceAction: "unit_status_read",
    unitRefKind: "none",
    hasUsableUnitInMessage: true,
    hasPersistedContextUnit: false,
    listenCandidate: true,
  }),
  "telemetry",
);

console.log("— Listen solo sin unit_status_read —");
assert.equal(
  decideUnitConsultMode({
    utteranceAction: "none",
    unitRefKind: "none",
    hasUsableUnitInMessage: true,
    hasPersistedContextUnit: true,
    listenCandidate: true,
  }),
  "listen_symptom",
);

console.log("— Tras GPS explicado, solo unit_status_read evita pushback —");
const pushback = resolveConversationalUnitTurn({
  rawText: "Indícamelo vos. Cómo ves la 300-089?",
  threadText: gpsExplainedThread,
  unitLabel: "OST 225",
});
assert.ok(pushback && /me adelanté/i.test(pushback), "sin action → pushback baseline");
assert.equal(
  resolveConversationalUnitTurn({
    rawText: "Indícamelo vos. Cómo ves la 300-089?",
    threadText: gpsExplainedThread,
    unitLabel: "OST 225",
    utteranceAction: "unit_status_read",
  }),
  null,
);

console.log("\n✓ verify-unit-status-structured-decision OK");
