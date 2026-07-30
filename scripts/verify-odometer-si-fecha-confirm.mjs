#!/usr/bin/env node
/**
 * Regresión — Bug real, producción 2026-07-29:
 * Tras confirmar km 123690, el bot preguntó fecha → "Si 19:00 de ayer" → bot mudo.
 *
 * Uso: npx tsx scripts/verify-odometer-si-fecha-confirm.mjs
 */
import assert from "node:assert";
import {
  looksLikePendingTramiteAffirmation,
  looksLikeBriefConfirmation,
  threadAwaitingOdometerConfirmDetails,
  threadHasActiveOdometerFlow,
} from "../src/lib/wara.ts";
import { shouldContinueOdometerFlow } from "../src/lib/waraApi.ts";
import { resolvePendingConfirmationExecutor } from "../src/lib/pendingConfirmation.ts";
import { parseFechaFromText } from "../src/lib/odometroFecha.ts";

let passed = 0;
function check(label, cond) {
  assert.ok(cond, label);
  passed++;
  console.log(`  ✓ ${label}`);
}

const thread = [
  "Estamos haciendo el cambio de odómetro para la unidad con patente OST 223.",
  "Para continuar con el registro del cambio de odómetro de la unidad con patente OST 223, necesito que me confirmes si el nuevo valor del odómetro es 123690 km. Además, ¿tenés una fecha y hora de la lectura, o asumimos que es hoy?",
].join("\n");

const msg = "Si 19:00 de ayer";

console.log("— Confirmación con fecha en el mismo mensaje —");
check("looksLikePendingTramiteAffirmation", looksLikePendingTramiteAffirmation(msg) === true);
check("NOT looksLikeBriefConfirmation pura", looksLikeBriefConfirmation(msg) === false);
check("parseFechaFromText captura ayer 19:00", parseFechaFromText(msg)?.includes("T19:00") === true);

console.log("\n— Flujo odómetro activo (no skip silencioso) —");
check("threadAwaitingOdometerConfirmDetails", threadAwaitingOdometerConfirmDetails(thread) === true);
check("threadHasActiveOdometerFlow", threadHasActiveOdometerFlow(thread) === true);
check("shouldContinueOdometerFlow", shouldContinueOdometerFlow(msg, thread) === true);

console.log("\n— Router pending confirm —");
check(
  "resolvePendingConfirmationExecutor → odometro (sin Voy a registrar formal)",
  resolvePendingConfirmationExecutor(thread, msg) === "odometro",
);

console.log(`\n✅ ${passed} checks pasaron.`);
