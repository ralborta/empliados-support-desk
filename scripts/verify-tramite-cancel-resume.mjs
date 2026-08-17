#!/usr/bin/env node
/**
 * Cancelación y reanudación de trámites inconclusos en cualquier servicio.
 * Uso: npx tsx scripts/verify-tramite-cancel-resume.mjs
 */
import assert from "node:assert/strict";
import {
  looksLikeTramiteCancellationIntent,
  threadHasInconclusiveTramite,
  buildTramiteCancellationReply,
  looksLikeResumeInconclusiveTramite,
  buildInconclusiveTramiteResumePrompt,
  resolveExecutorForInconclusiveTramite,
} from "../src/lib/tramiteFlowControl.ts";
import { shouldRouteTurnToOdometerExecutor } from "../src/lib/waraUnitIntent.ts";

let passed = 0;
function check(label, cond) {
  assert.ok(cond, label);
  passed++;
  console.log(`  ✓ ${label}`);
}

console.log("▶ Cancelación — frases habituales");
for (const phrase of [
  "cancelar",
  "ya no quiero",
  "no quiero ahora",
  "no quiero por ahora",
  "ahora no",
  "olvidalo",
  "no quiero el certificado",
  "anular el tramite",
]) {
  check(`"${phrase}"`, looksLikeTramiteCancellationIntent(phrase));
}
check('"no" solo NO es cancelación global', !looksLikeTramiteCancellationIntent("no"));

const odoMidFlow = [
  "Cliente: Quiero cambiar el horometro de la unidad 900096",
  "Atilio: Para registrar el cambio de horómetro necesito la patente de la unidad.",
].join("\n");

console.log("\n▶ Trámite inconcluso detectado");
check("horómetro a medias", threadHasInconclusiveTramite(odoMidFlow, null));
check(
  "cancelar → mensaje odómetro",
  buildTramiteCancellationReply(odoMidFlow, null).includes("odómetro"),
);

const certMid = [
  "Atilio: Para el certificado de cobertura necesito la unidad. Pasame la patente.",
].join("\n");
check("certificado awaiting_unit", threadHasInconclusiveTramite(certMid, null));

console.log("\n▶ Reanudar trámite inconcluso");
check("seguimos", looksLikeResumeInconclusiveTramite("seguimos con el horometro"));
check("continuemos", looksLikeResumeInconclusiveTramite("continuemos"));
check(
  "resume prompt horómetro",
  buildInconclusiveTramiteResumePrompt(odoMidFlow, null).includes("horómetro"),
);
check(
  "executor odometro",
  resolveExecutorForInconclusiveTramite(odoMidFlow, null) === "odometro",
);

console.log("\n▶ Tras cancelar, dato nuevo sigue siendo trámite (no GPS)");
const afterCancelThread = [
  odoMidFlow,
  "Cliente: cancelar",
  "Atilio: Entendido, no registro ese cambio.",
  "Cliente: Quiero cambiar el horometro de la unidad 900114",
].join("\n");
check(
  "arranque explícito post-cancel",
  shouldRouteTurnToOdometerExecutor({
    selectionText: "Quiero cambiar el horometro de la unidad 900114",
    threadText: afterCancelThread,
    pendingActionType: null,
  }),
);

console.log(`\nOK — ${passed} checks`);
