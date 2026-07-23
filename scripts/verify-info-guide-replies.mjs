#!/usr/bin/env node
/**
 * Regresión del bug real (producción, 2026-07-22): tras "quiero configurar la agenda",
 * la pregunta de seguimiento "y como registro un contacto?" caía en el MISMO balde de
 * palabras clave ("agenda|contacto|turno") y el bot repetía el bloque de texto
 * TEXTUALMENTE igual, dando la sensación de no escuchar la pregunta puntual. Además,
 * "como se define el perfil?" nunca explicaba qué ES un perfil, solo el paso a paso
 * para gestionarlo.
 *
 * Uso: npx tsx scripts/verify-info-guide-replies.mjs
 */
import { buildInfoGuideReply, detectInfoGuideKind } from "../src/lib/infoGuideReplies.ts";

let failed = 0;
function assert(cond, label) {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}

console.log("— Seguimiento puntual sobre \"cómo registro un contacto\" —");

const agendaGeneral = buildInfoGuideReply("quiero configurar la agenda");
const comoRegistro = buildInfoGuideReply("y como registro un contacto?", null, agendaGeneral);
assert(
  comoRegistro !== agendaGeneral,
  "\"como registro un contacto\" ya NO repite textualmente el bloque general de agenda",
);
assert(
  /nuevo contacto|registrar un contacto/i.test(comoRegistro),
  "la respuesta puntual menciona específicamente cómo registrar/agregar el contacto",
);

console.log("— \"¿Cómo se define el perfil?\" ahora explica qué ES un perfil —");

const perfilReply = buildInfoGuideReply("como se define el perfil?");
assert(
  /es una plantilla de permisos/i.test(perfilReply),
  "la respuesta sobre perfil define el concepto (no solo el paso a paso)",
);

console.log("— Salvaguarda anti-repetición genérica —");

const sameKindDifferentQuestion = buildInfoGuideReply("quiero configurar la agenda");
const repeated = buildInfoGuideReply("quiero configurar la agenda", null, sameKindDifferentQuestion);
assert(
  repeated !== sameKindDifferentQuestion,
  "si la pregunta cae en el mismo balde y el texto sería idéntico al último del bot, no lo repite literal",
);
assert(
  /puntualmente|específicamente|específica/i.test(repeated),
  "el mensaje de anti-repetición pide precisión en vez de repetir el bloque",
);

console.log("— Detección de tipo de guía no se rompe —");

assert(detectInfoGuideKind("quiero configurar la agenda") === "opciones", "agenda → opciones");
assert(detectInfoGuideKind("como se define el perfil?") === "opciones", "perfil → opciones");

if (failed > 0) {
  console.error(`\n✗ ${failed} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ Verificación de respuestas de guías informativas OK (sin repetición literal)");
