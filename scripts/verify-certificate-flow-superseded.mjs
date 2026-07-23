#!/usr/bin/env node
/**
 * Regresión del bug real (producción, 2026-07-23, screenshot "Qué unidad estamos
 * viendo?" / "No era esa era la Nissan"):
 *
 *   1. El certificado pregunta la unidad ("Para el certificado de cobertura necesito
 *      la unidad...").
 *   2. El cliente cambia de trámite: "Quiero ver el estado de mi unidad" — el bot
 *      responde con el estado GPS de una unidad (trámite de ESTADO, no certificado).
 *   3. El cliente corrige: "No era esa era la Nissan" — como esto menciona una marca
 *      (looksLikeVehicleBrandOrUnitSearch), y la frase del certificado del paso 1
 *      TODAVÍA estaba dentro de la ventana de 12 líneas que mira certificateFlowState,
 *      el router mandaba esta corrección al trámite de CERTIFICADO en vez de al de
 *      ESTADO — el bot contestaba "el certificado ya fue enviado", totalmente fuera de
 *      contexto de lo que el cliente estaba corrigiendo.
 *
 * Fix: isCertificateFlowSuperseded (src/lib/wara.ts) detecta que después del "necesito
 * la unidad" del certificado hubo una respuesta de OTRO trámite (GPS/estado, odómetro,
 * mantenimiento, otra guía) y hace que certificateFlowState devuelva "none" en vez de
 * seguir arrastrando "awaiting_unit" solo porque la frase vieja sigue en la ventana.
 *
 * Uso: npx tsx scripts/verify-certificate-flow-superseded.mjs
 */
import { certificateFlowState, isCertificateFlowSuperseded } from "../src/lib/wara.ts";
import { classifyTurnExecutor } from "../src/lib/whatsappTurnRouter.ts";

let failed = 0;
function assert(cond, label) {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}

const certificateAsksUnit =
  "Para el certificado de cobertura necesito la unidad: decime la patente (ej. AD 427 MC), el nombre o la marca (ej. Saveiro, Nissan) o un prefijo (ej. HEJ).";
const estadoReply =
  "La unidad AE 483 VE (SAVEIRO - AE 483 VE) está detenida. La ignición se encuentra apagada y la última posición coincide con ese estado, por lo que es normal que no actualice su ubicación. No se generará un ticket por el momento. Si la situación cambia, no dudes en consultarnos nuevamente.";

console.log("— Sin ninguna otra cosa después, el certificado SIGUE 'awaiting_unit' (comportamiento previo intacto) —");
const threadJustAsked = ["Qué unidad estamos viendo?", certificateAsksUnit].join("\n");
assert(!isCertificateFlowSuperseded(threadJustAsked), "isCertificateFlowSuperseded es false recién preguntado");
assert(
  certificateFlowState(threadJustAsked) === "awaiting_unit",
  "certificateFlowState sigue 'awaiting_unit' (sin otro trámite de por medio)",
);
assert(
  classifyTurnExecutor("Nissan", threadJustAsked) === "certificados",
  "responder la marca en este punto SÍ se enruta a certificados (flujo normal intacto)",
);

console.log("\n— Bug real: tras un trámite de ESTADO de por medio, el certificado quedó abandonado —");
const threadWithEstadoInBetween = [
  "Qué unidad estamos viendo?",
  certificateAsksUnit,
  "Quiero ver el estado de mi unidad",
  estadoReply,
].join("\n");
assert(
  isCertificateFlowSuperseded(threadWithEstadoInBetween),
  "isCertificateFlowSuperseded es true tras la respuesta de estado GPS",
);
assert(
  certificateFlowState(threadWithEstadoInBetween) === "none",
  "certificateFlowState ya no es 'awaiting_unit' (el trámite de certificado quedó atrás)",
);
assert(
  classifyTurnExecutor("No era esa era la Nissan", threadWithEstadoInBetween) !== "certificados",
  "'No era esa era la Nissan' (corrección de ESTADO) ya NO se enruta al certificado viejo",
);

console.log("\n— Sanity: el fix de referencia vaga cruzando de trámite (estado → certificado) sigue intacto —");
const crossFlowThread = [
  "Quiero ver el estado de la Nissan",
  "La unidad AG 562 SP (NISSAN 2404 - AG 562 SP) está funcionando normalmente, enviando reportes y posición actualizados.",
].join("\n");
assert(
  !isCertificateFlowSuperseded(crossFlowThread),
  "sin ningún 'necesito la unidad' de certificado previo, isCertificateFlowSuperseded es false (no hay nada que suplantar)",
);
assert(
  certificateFlowState(crossFlowThread) === "none",
  "certificateFlowState sigue 'none' en este hilo (nunca fue 'awaiting_unit', el otro fix cubre este caso por otro lado)",
);

if (failed > 0) {
  console.error(`\n✗ ${failed} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ Verificación de trámite de certificado suplantado por otro flujo OK");
