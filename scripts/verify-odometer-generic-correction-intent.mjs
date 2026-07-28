#!/usr/bin/env node
/**
 * Regresión bug real 2026-07-28 (captura cliente, cambio de horómetro M300-129 / AD 626 UJ):
 * tras el resumen "Voy a registrar: Patente AD 626 UJ, Horómetro 300 h... respondé CONFIRMO",
 * el cliente escribió "corregir datos" (sin decir todavía cuál dato ni el valor nuevo) y el
 * bot repitió el recordatorio genérico de CONFIRMO como si no hubiera dicho nada — no había
 * ninguna palabra clave que el bot reconociera como intención de corrección.
 *
 * También cubre el gancho relacionado: una vez que el cliente SÍ da el valor nuevo de
 * horómetro/odómetro (sin mencionar fecha/hora, que es lo único que looksLikeOdometer-
 * PendingDataAmendment reconocía antes), debe reabrir el trámite con el valor nuevo en vez
 * de seguir atrapado en el recordatorio.
 */
import {
  looksLikeGenericCorrectionIntent,
  looksLikeOdometerPendingDataAmendment,
} from "../src/lib/wara.ts";
import { looksLikePlateCorrectionRequest } from "../src/lib/waraApi.ts";

let failed = 0;
function assert(cond, label) {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}

console.log("— Intención genérica de corrección sin dato nuevo (caso real del cliente) —");
assert(looksLikeGenericCorrectionIntent("corregir datos"), '"corregir datos" detectado');
assert(looksLikeGenericCorrectionIntent("corregir los datos"), '"corregir los datos" detectado');
assert(looksLikeGenericCorrectionIntent("quiero modificar los datos"), '"modificar los datos" detectado');
assert(looksLikeGenericCorrectionIntent("corrijo eso"), '"corrijo eso" detectado');
assert(looksLikeGenericCorrectionIntent("corregirlo"), '"corregirlo" detectado');
assert(looksLikeGenericCorrectionIntent("hay un error"), '"hay un error" detectado');
assert(
  looksLikeGenericCorrectionIntent("tiene un error el registro"),
  '"tiene un error" detectado',
);

console.log("\n— No debe pisar flujos ya cubiertos por otras funciones —");
assert(
  !looksLikeGenericCorrectionIntent("quiero corregir la patente"),
  '"corregir la patente" NO es genérico (ya lo cubre looksLikePlateCorrectionRequest)',
);
assert(
  looksLikePlateCorrectionRequest("quiero corregir la patente"),
  "…y sí lo cubre looksLikePlateCorrectionRequest",
);
assert(
  !looksLikeGenericCorrectionIntent("CONFIRMO"),
  '"CONFIRMO" no se confunde con pedido de corrección',
);
assert(!looksLikeGenericCorrectionIntent("hola, buenas"), "saludo normal no dispara falso positivo");
assert(
  !looksLikeGenericCorrectionIntent("300"),
  "un número solo no se confunde con intención de corrección",
);

console.log("\n— Valor nuevo de horómetro/odómetro (sin fecha/hora) SÍ reabre la confirmación —");
assert(
  looksLikeOdometerPendingDataAmendment("el horómetro correcto es 350"),
  '"el horómetro correcto es 350" es una enmienda',
);
assert(
  looksLikeOdometerPendingDataAmendment("corrijo el odómetro a 12000"),
  '"corrijo el odómetro a 12000" es una enmienda',
);
assert(
  looksLikeOdometerPendingDataAmendment("horometro 350hs"),
  '"horometro 350hs" es una enmienda',
);
assert(
  !looksLikeOdometerPendingDataAmendment("corregir datos"),
  '"corregir datos" (sin valor) NO se confunde con una enmienda ya resuelta',
);
assert(
  !looksLikeOdometerPendingDataAmendment("hola, buenas"),
  "saludo normal sigue sin ser una enmienda (sin falsos positivos)",
);
assert(
  !looksLikeOdometerPendingDataAmendment("300"),
  "un número solo (sin patente/odómetro/horómetro/fecha) sigue sin ser una enmienda",
);

if (failed > 0) {
  console.error(`\n✗ ${failed} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ Corrección genérica de datos en odómetro/horómetro OK");
