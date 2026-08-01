#!/usr/bin/env node
/**
 * Regresión bug real 2026-07-31 (hilo AC 574 RC):
 * - "¿Esta reportando?" / "No esta reportando" → executor unidades (GPS), no agente.
 * - "La veo detenida" → NO prefijo VEO ni búsqueda de patente inventada.
 * - Referencia al certificado + unidad en hilo → unidades con contexto.
 *
 * Uso: npx tsx scripts/verify-ac574-reporting-thread.mjs
 */
import { extractPlatePrefixFromMessage } from "../src/lib/wara.ts";
import {
  looksLikeGpsOrUnitStatusQuestion,
  looksLikeUnitConsultFollowUp,
  looksLikeUnitReportingStatusCue,
  threadHasRecentUnitProblemListenPrompt,
} from "../src/lib/waraApi.ts";
import {
  looksLikeVagueUnitReference,
  shouldRouteTurnToUnidadesExecutor,
} from "../src/lib/waraUnitIntent.ts";
import { detectUnitConsultQuestion } from "../src/lib/unitDialogueState.ts";

let failed = 0;
function assert(cond, label) {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}

const certThread = [
  "Atilio: Listo, acá tenés el certificado para la patente AC 574 RC: https://example.com/cert.pdf",
  "Cliente: Entiendo que ves la unidad detenida. Para ayudarte mejor, ¿podrías darme la patente completa?",
  "Cliente: la misma unidad que me diste el certificado",
].join("\n");

const listenThread = [
  certThread,
  "Atilio: Con AC 574 RC (M600-039), contame qué problema estás viendo: ¿no reporta ahora, no ves movimiento/recorrido en el historial, ignición, u otra cosa?",
].join("\n");

console.log("— Detección consulta GPS / reporte —");
for (const msg of [
  "¿Esta reportando esa unidad?",
  "¿Esta reportando?",
  "No esta reportando",
  "La veo detenida, no esta reportando",
]) {
  assert(looksLikeUnitReportingStatusCue(msg), `looksLikeUnitReportingStatusCue("${msg}")`);
  assert(looksLikeGpsOrUnitStatusQuestion(msg), `looksLikeGpsOrUnitStatusQuestion("${msg}")`);
}

console.log("\n— Prefijo VEO (la veo ≠ patente) —");
assert(
  extractPlatePrefixFromMessage("La veo detenida, no esta reportando") === null,
  'extractPlatePrefixFromMessage("La veo detenida...") === null',
);
assert(
  extractPlatePrefixFromMessage("La q empieza con NKL") === "NKL",
  'prefijo real NKL sigue intacto',
);

console.log("\n— Enrutamiento a executor unidades —");
assert(
  shouldRouteTurnToUnidadesExecutor({ selectionText: "No esta reportando", threadText: listenThread }),
  'shouldRouteTurnToUnidadesExecutor("No esta reportando")',
);
assert(
  shouldRouteTurnToUnidadesExecutor({
    selectionText: "La veo detenida, no esta reportando",
    threadText: listenThread,
  }),
  'shouldRouteTurnToUnidadesExecutor("La veo detenida...")',
);
assert(
  shouldRouteTurnToUnidadesExecutor({
    selectionText: "¿Esta reportando?",
    threadText: listenThread,
  }),
  'shouldRouteTurnToUnidadesExecutor("¿Esta reportando?")',
);
assert(
  shouldRouteTurnToUnidadesExecutor({
    selectionText: "la misma unidad que me diste el certificado",
    threadText: certThread,
  }),
  'shouldRouteTurnToUnidadesExecutor(ref certificado + hilo AC574)',
);

console.log("\n— Follow-up y escucha de síntoma —");
assert(
  threadHasRecentUnitProblemListenPrompt(listenThread),
  "threadHasRecentUnitProblemListenPrompt tras pedido de síntoma",
);
assert(
  looksLikeUnitConsultFollowUp("No esta reportando"),
  'looksLikeUnitConsultFollowUp("No esta reportando")',
);
assert(
  detectUnitConsultQuestion("¿Esta reportando?") === "consulta_reportando",
  'detectUnitConsultQuestion("¿Esta reportando?")',
);
assert(
  looksLikeVagueUnitReference("la misma unidad que me diste el certificado"),
  "referencia vaga al certificado",
);

if (failed > 0) {
  console.error(`\n✗ ${failed} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ Hilo AC 574 RC / reportando OK");
