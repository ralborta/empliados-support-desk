#!/usr/bin/env node
/**
 * Regresión bug prod 2026-08-25 (Emii / OST 225):
 * Tras resumen GPS y cierre «¿Seguimos con el estado…?», el cliente responde
 * «Seguimos con el estado de la misma unidad» — debe reusar OST 225 del hilo aunque
 * activeUnit en DB haya vencido (>45 min), no pedir matrícula de nuevo.
 *
 * Uso: npx tsx scripts/verify-gps-status-continuity.mjs
 */
import {
  buildTemplateSummary,
  looksLikeGpsStatusContinuityReply,
  resolvePlateFromRecentGpsThread,
  threadHasRecentGpsContext,
} from "../src/lib/waraGpsSummary.ts";
import { classifyTurnExecutor } from "../src/lib/whatsappTurnRouter.ts";
import { shouldUseActiveUnitFallback } from "../src/lib/activeUnit.ts";

let failed = 0;
function assert(cond, label) {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}

function parkedUnit() {
  return {
    movil_id: 300089,
    unidad: "M300-089",
    patente: "OST225",
    ultimo_reporte: { hace_segundos: 120 },
    ultima_posicion: { hace_segundos: 120, lat: -32.89, lon: -68.84 },
    ultima_ignicion: { estado: false, hace_segundos: 3600 },
  };
}

const gpsSummary = buildTemplateSummary({
  unitLabel: "OST 225 (M300-089)",
  unit: parkedUnit(),
  assessment: {
    status: "coherent_pause",
    reportElapsed: 120,
    positionElapsed: 120,
    ignitionElapsed: 3600,
  },
  action: "observation",
});

const thread = [
  "Cliente: 600-039 no reporta",
  "Atilio: " + gpsSummary.replace(/\n/g, "\n"),
].join("\n");

const followUp = "Seguimos con el estado de la misma unidad";

console.log("— Detección continuidad GPS —");
assert(looksLikeGpsStatusContinuityReply(followUp), "continuidad GPS reconocida");
assert(threadHasRecentGpsContext(thread), "hilo con resumen GPS estructurado");
assert(resolvePlateFromRecentGpsThread(thread) === "OST225", "patente OST225 desde hilo");

console.log("\n— Routing —");
assert(classifyTurnExecutor(followUp, thread) === "unidades", "router → unidades");

console.log("\n— Sin activeUnit en DB —");
assert(shouldUseActiveUnitFallback(followUp), "fallback activeUnit permitido (no pide otra unidad genérica)");

if (failed > 0) {
  console.error(`\n✗ ${failed} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ Continuidad GPS tras cierre OK");
