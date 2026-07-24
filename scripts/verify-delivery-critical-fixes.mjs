#!/usr/bin/env node
/**
 * Regresión de fixes críticos para entrega al cliente (jul-2026).
 */
import { classifyTurnExecutor } from "../src/lib/whatsappTurnRouter.ts";
import {
  isBarePlatePrefixHint,
  looksLikeBriefConfirmation,
  looksLikeExplicitCertificateResendRequest,
  looksLikeHorometerOnlyIntent,
  looksLikeOdometerIntentStart,
  threadTextSinceCompanySelection,
} from "../src/lib/wara.ts";
import {
  looksLikeImplicitCompanyChangeAffirmation,
  looksLikeOdometerConfirmationRejection,
} from "../src/lib/waraApi.ts";
import { resolveUnitQuery } from "../src/lib/waraUnitIntent.ts";

let failed = 0;
function assert(cond, label) {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}

console.log("— Unidad 600-117 no matchea patente por substring —");
const fleet = [
  { movil_id: 1, patente: "ESLA600117", unidad: "OTRA" },
  { movil_id: 2, patente: "NKL954", unidad: "M300-112" },
  { movil_id: 3, patente: "NKL955", unidad: "600-117" },
];
const r600 = await resolveUnitQuery({
  rawText: "600-117",
  threadText: "",
  units: fleet,
  preferAi: false,
});
assert(r600.plate === "NKL955", `600-117 → unidad por nombre (obtuvo ${r600.plate})`);

console.log("\n— 'si' no es prefijo de patente —");
assert(looksLikeBriefConfirmation("si"), "si es confirmación breve");
assert(!isBarePlatePrefixHint("si"), "si NO es prefijo de patente");

console.log("\n— Horómetro vs odómetro —");
assert(looksLikeHorometerOnlyIntent("ajustame el horometro de la unidad mencionada"), "detecta solo horómetro");
assert(looksLikeOdometerIntentStart("Quiero realizar un ajuste de horometro"), "ajuste de horometro = arranque");

console.log("\n— Rechazo de confirmación odómetro —");
assert(looksLikeOdometerConfirmationRejection("no es correcto"), "no es correcto = rechazo");
assert(looksLikeOdometerConfirmationRejection("no confirmo quiero otra gestion"), "otra gestión = rechazo");
assert(!looksLikeOdometerConfirmationRejection("confirmo"), "confirmo NO es rechazo");

console.log("\n— Reenvío certificado enruta a certificados —");
const resendMsg = "reenviar el certificado";
assert(looksLikeExplicitCertificateResendRequest(resendMsg), "detecta reenvío explícito");
assert(classifyTurnExecutor(resendMsg, "") === "certificados", "router → certificados");

console.log("\n— Cambio de empresa implícito —");
const threadChange = "No encontré la patente. Revisá o escribí cambiar empresa.";
assert(
  looksLikeImplicitCompanyChangeAffirmation("dale cambialo", threadChange),
  "dale cambialo tras pedido de cambiar empresa",
);

console.log("\n— Reinicio empresa limpia hilo —");
const scoped = threadTextSinceCompanySelection(
  ["No encontré AE 483 VE", "Perfecto, sigo con El Cacique S.A.", "Quiero certificado"].join("\n"),
);
assert(!scoped.includes("AE 483"), "patente vieja fuera del hilo scoped");

if (failed > 0) {
  console.error(`\n✗ ${failed} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ Fixes críticos de entrega OK");
