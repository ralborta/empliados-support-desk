#!/usr/bin/env node
/**
 * Regresión AG 562 SP: enmienda fecha + "no confirmo" en confirmación pendiente.
 */
import {
  looksLikeOdometerPendingDataAmendment,
} from "../src/lib/wara.ts";
import {
  looksLikeOdometerConfirmationRejection,
} from "../src/lib/waraApi.ts";
import { parseFechaFromText } from "../src/lib/odometroFecha.ts";
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

const amend = "la fecha y hora estan mal, es de ayer a las 21:30";
assert(looksLikeOdometerPendingDataAmendment(amend), "enmienda fecha/hora detectada");
const parsed = parseFechaFromText(amend, "America/Argentina/Buenos_Aires");
assert(!!parsed && /T21:30:00$/.test(parsed), `parsea ayer 21:30 (${parsed})`);

assert(looksLikeOdometerConfirmationRejection("no confirmo"), "no confirmo es rechazo");

const fleet = [{ movil_id: 1, patente: "AG562SP", unidad: "NISSAN" }];
const uq = await resolveUnitQuery({
  rawText: "no confirmo",
  threadText: "Voy a registrar: Patente AG 562 SP. Respondé CONFIRMO.",
  units: fleet,
  preferAi: false,
});
assert(
  uq.intent !== "consult_status" && !(uq.clarificationQuestion ?? "").includes("no confirmo"),
  "no confirmo NO se busca como unidad en flota",
);

if (failed > 0) {
  console.error(`\n✗ ${failed} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ Enmienda fecha + no confirmo OK");
