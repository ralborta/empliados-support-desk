#!/usr/bin/env node
/**
 * Regresión producción 2026-07-28: certificado (HEJ) -> cambio de odómetro con patente
 * equivocada (LWK 7902) -> corrección a HEJ -> nuevo valor de odómetro.
 *
 * El "Voy a registrar: Patente LWK 7902..." viejo seguía dentro de la ventana de
 * hasPendingOdometerConfirmation() aunque el bot ya había reabierto el trámite
 * pidiendo un valor nuevo ("Perfecto, tomo HEJ. ¿Cuál es el nuevo odómetro en km?").
 * El valor nuevo dado por el cliente (123551) quedaba atrapado por el recordatorio
 * de CONFIRMO de la confirmación vieja en vez de generar el resumen nuevo.
 */
import { hasPendingOdometerConfirmation } from "../src/lib/wara.ts";

let failed = 0;
function assert(cond, label) {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}

const threadBeforeCorrection = [
  "Cliente: quiero q emitas un certificado",
  "Bot: Voy a generar el certificado de cobertura:\nPatente: HEJ\nEmpresa: WARA\n\nSi esta correcto, responde CONFIRMO para solicitarlo a Wara.",
  "Cliente: si",
  "Bot: Perfecto, generé el certificado de cobertura para WARA, patente LWK 7902.",
  "Cliente: ahora quiero cambias el odometro",
  "Bot: Perfecto, tomo LWK 7902. ¿Cuál es el nuevo odómetro en km?",
  "Cliente: 122556",
  "Bot: Voy a registrar:\n• Patente: LWK 7902\n• Odómetro: 122556 km\n\nSi está correcto, respondé CONFIRMO para registrarlo en Wara.",
  "Cliente: no para la unidad HEJ",
  "Bot: Entendido. ¿Cuál es la patente correcta? Podés pasarme la matrícula (ej. AB 123 CD) o el nombre/marca de la unidad.",
].join("\n");

assert(
  hasPendingOdometerConfirmation(threadBeforeCorrection),
  "tras 'no para la unidad HEJ' sigue pendiente la confirmacion original (aun no se reabrio con nuevo valor)",
);

const threadAfterReopen = [
  threadBeforeCorrection,
  "Cliente: HEJ",
  "Bot: Perfecto, tomo HEJ. ¿Cuál es el nuevo odómetro en km?",
].join("\n");

assert(
  !hasPendingOdometerConfirmation(threadAfterReopen),
  "tras 'Perfecto, tomo HEJ. ¿Cuál es el nuevo odómetro en km?' el tramite viejo YA NO esta pendiente (se reabrio pidiendo valor nuevo)",
);

// El flujo normal (sin corrección) debe seguir funcionando: confirmación recién
// generada, sin ningún "perfecto, tomo" / "cuál es el nuevo odómetro" posterior.
const normalPendingThread = [
  "Cliente: cambio el odometro de la HEJ",
  "Bot: Perfecto, tomo HEJ. ¿Cuál es el nuevo odómetro en km?",
  "Cliente: 123551",
  "Bot: Voy a registrar:\n• Patente: HEJ\n• Odómetro: 123551 km\n\nSi está correcto, respondé CONFIRMO para registrarlo en Wara.",
].join("\n");
assert(
  hasPendingOdometerConfirmation(normalPendingThread),
  "flujo normal sin correccion: confirmacion recien generada SIGUE pendiente",
);

if (failed > 0) {
  console.error(`\n✗ ${failed} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ Corrección de patente reabre el trámite y no queda atrapado en CONFIRMO viejo");
