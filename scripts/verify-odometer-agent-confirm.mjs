#!/usr/bin/env node
/**
 * Regresión — Bug real, producción 2026-07-29:
 * Agente parafrasea confirmación ("¿Confirmás que estos datos... OST 223, 123690 km")
 * sin "Voy a registrar:" → "Ahora si perfecto" / "Confirmo" pierde patente y pide de nuevo.
 *
 * Uso: npx tsx scripts/verify-odometer-agent-confirm.mjs
 */
import assert from "node:assert";
import {
  extractOdometroFromOdometerContext,
  extractPlateFromOdometerSummary,
  hasPendingOdometerConfirmation,
  looksLikeBriefConfirmation,
  looksLikePendingTramiteAffirmation,
  threadAwaitingOdometerConfirmDetails,
  threadHasActiveOdometerFlow,
  threadHasAgentStyleOdometerConfirmPending,
} from "../src/lib/wara.ts";
import { resolvePendingConfirmationExecutor } from "../src/lib/pendingConfirmation.ts";

let passed = 0;
function check(label, cond) {
  assert.ok(cond, label);
  passed++;
  console.log(`  ✓ ${label}`);
}

const agentSummary =
  "Para registrar el cambio de odómetro de la unidad con patente OST 223, el nuevo valor es 123690 km y la fecha y hora de la lectura es el 28 de julio de 2026 a las 19:00. ¿Confirmás que estos datos son correctos para proceder?";

console.log("— Resumen parafraseado por agente IA —");
check("threadHasAgentStyleOdometerConfirmPending", threadHasAgentStyleOdometerConfirmPending(agentSummary) === true);
check("hasPendingOdometerConfirmation", hasPendingOdometerConfirmation(agentSummary) === true);
check("threadAwaitingOdometerConfirmDetails", threadAwaitingOdometerConfirmDetails(agentSummary) === true);
check("extractPlate OST 223", extractPlateFromOdometerSummary(agentSummary) === "OST223");
check("extractOdometro 123690", extractOdometroFromOdometerContext(agentSummary) === 123690);

console.log("\n— Afirmaciones naturales —");
check('"Ahora si perfecto" brief confirm', looksLikeBriefConfirmation("Ahora si perfecto") === true);
check('"Ahora si perfecto" pending affirmation', looksLikePendingTramiteAffirmation("Ahora si perfecto") === true);
check('"Confirmo" brief confirm', looksLikeBriefConfirmation("Confirmo") === true);

console.log("\n— Router pending confirm —");
check(
  'resolvePendingConfirmationExecutor("Confirmo") → odometro',
  resolvePendingConfirmationExecutor(agentSummary, "Confirmo") === "odometro",
);
check(
  'resolvePendingConfirmationExecutor("Ahora si perfecto") → odometro',
  resolvePendingConfirmationExecutor(agentSummary, "Ahora si perfecto") === "odometro",
);
check("threadHasActiveOdometerFlow", threadHasActiveOdometerFlow(agentSummary) === true);

console.log(`\n✅ ${passed} checks pasaron.`);
