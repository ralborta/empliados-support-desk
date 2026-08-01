#!/usr/bin/env node
/**
 * Regresión bug real 2026-07-31 (Emii / AG 562 SP):
 * - "Gracias" sin CONFIRMO no debe abandonar el trámite ni dejar "confirmo" en silencio.
 * - Fecha truncada "14/07/202" debe inferirse con la hora del mensaje.
 *
 * Uso: npx tsx scripts/verify-odometer-gracias-pending-confirm.mjs
 */
import {
  hasPendingOdometerConfirmation,
  isOdometerFlowSuperseded,
} from "../src/lib/wara.ts";
import {
  shouldContinueOdometerFlow,
  looksLikeConversationAcknowledgement,
} from "../src/lib/waraApi.ts";
import {
  resolvePendingConfirmationExecutor,
  hasAnyPendingConfirmation,
  buildPendingConfirmationPoliteAckReply,
} from "../src/lib/pendingConfirmation.ts";
import { parseFechaFromText } from "../src/lib/odometroFecha.ts";

let failed = 0;
function assert(cond, label) {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}

const pendingSummary = [
  "Atilio: Voy a registrar:",
  "• Patente: AG 562 SP",
  "• Odómetro: 123456789 km",
  "Si está correcto, respondé CONFIRMO para registrarlo en Wara.",
].join("\n");

const afterGraciasBotWrong = [
  pendingSummary,
  "Cliente: Gracias",
  "Atilio: De nada, Emii. ¿Necesitás algo más?",
].join("\n");

const afterGraciasBotFixed = [
  pendingSummary,
  "Cliente: Gracias",
  "Atilio: Emii, de nada. Todavía tengo pendiente el registro del resumen anterior. ¿Querés confirmarlo respondiendo CONFIRMO, corregir algún dato, o preferís hacer otra gestión?",
].join("\n");

console.log("— Confirmación pendiente —");
assert(hasPendingOdometerConfirmation(pendingSummary), "hasPendingOdometerConfirmation en resumen");
assert(hasAnyPendingConfirmation(pendingSummary), "hasAnyPendingConfirmation");

console.log("\n— 'Gracias' no abandona el trámite —");
assert(
  !isOdometerFlowSuperseded(afterGraciasBotWrong),
  "isOdometerFlowSuperseded === false tras 'De nada' con CONFIRMO pendiente",
);
assert(
  hasPendingOdometerConfirmation(afterGraciasBotWrong),
  "hasPendingOdometerConfirmation sigue true tras 'De nada'",
);
assert(
  resolvePendingConfirmationExecutor(afterGraciasBotWrong, "confirmo") === "odometro",
  'resolvePendingConfirmationExecutor("confirmo") → odometro',
);
assert(
  shouldContinueOdometerFlow("Gracias", pendingSummary),
  "shouldContinueOdometerFlow('Gracias') con confirmación pendiente",
);

console.log("\n— Respuesta educada mientras hay CONFIRMO pendiente —");
const polite = buildPendingConfirmationPoliteAckReply(pendingSummary, "Emii");
assert(polite.includes("CONFIRMO"), "buildPendingConfirmationPoliteAckReply menciona CONFIRMO");
assert(
  looksLikeConversationAcknowledgement("Gracias"),
  "sanity: Gracias es ack conversacional",
);

console.log("\n— Fecha truncada 14/07/202 + Hora —");
const kmBlock = "Kilometraje: 123456789\nHora: 14:50\nfecha: 14/07/202";
const parsed = parseFechaFromText(kmBlock, "America/Argentina/Buenos_Aires");
assert(parsed?.includes("T14:50"), `parseFechaFromText incluye hora 14:50 (${parsed})`);
assert(parsed?.startsWith("2026-07-14"), `parseFechaFromText año inferido 2026 (${parsed})`);
assert(
  parseFechaFromText("fecha: 14/07/202", "America/Argentina/Buenos_Aires") === undefined ||
    parseFechaFromText("fecha: 14/07/202", "America/Argentina/Buenos_Aires")?.startsWith("2026"),
  "fecha solo truncada: inferida o undefined (no año 202 inválido)",
);

if (failed > 0) {
  console.error(`\n✗ ${failed} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ Gracias / CONFIRMO pendiente OK");
