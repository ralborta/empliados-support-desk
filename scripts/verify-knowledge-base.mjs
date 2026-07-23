#!/usr/bin/env node
/**
 * Verifica que la base de conocimiento real (PDFs de Opciones/Unidades recuperados tras
 * el borrado accidental de los flows ChatPDF de BuilderBot, ver docs/) esté cargada y que
 * `buildGroundedInfoGuideReply` NUNCA deje al cliente sin respuesta cuando no hay
 * OPENAI_API_KEY (debe caer al texto estático de siempre). No pega a la red real —
 * eso se corre aparte con scripts/smoke-knowledge-base-ai.mjs.
 *
 * Uso: npx tsx scripts/verify-knowledge-base.mjs
 */
import { OPCIONES_KNOWLEDGE_BASE, UNIDADES_KNOWLEDGE_BASE } from "../src/lib/knowledgeBase.ts";
import { buildGroundedInfoGuideReply } from "../src/lib/infoGuideReplies.ts";

let failed = 0;
function assert(cond, label) {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}

console.log("— Contenido real del manual embebido —");
assert(OPCIONES_KNOWLEDGE_BASE.includes("plantilla de permisos"), "Opciones: define qué es un perfil");
assert(OPCIONES_KNOWLEDGE_BASE.includes("PEGAR TABLA"), "Opciones: incluye detalle de Agenda");
assert(OPCIONES_KNOWLEDGE_BASE.includes("Notificaciones"), "Opciones: incluye sección Notificaciones");
assert(UNIDADES_KNOWLEDGE_BASE.includes("MIS ATAJOS"), "Unidades: incluye sección MIS ATAJOS");
assert(UNIDADES_KNOWLEDGE_BASE.includes("punto rojo") || UNIDADES_KNOWLEDGE_BASE.includes("Rojo"), "Unidades: explica el código de colores");
assert(OPCIONES_KNOWLEDGE_BASE.length > 2000, "Opciones: manual tiene contenido sustancial (no truncado)");
assert(UNIDADES_KNOWLEDGE_BASE.length > 2000, "Unidades: manual tiene contenido sustancial (no truncado)");

console.log("\n— Fallback sin OPENAI_API_KEY (no debe romper ni dejar sin respuesta) —");
const originalKey = process.env.OPENAI_API_KEY;
delete process.env.OPENAI_API_KEY;

try {
  const opciones = await buildGroundedInfoGuideReply("que es un perfil?", "opciones");
  assert(typeof opciones === "string" && opciones.length > 0, "opciones sin API key devuelve texto estático (no vacío)");

  const unidades = await buildGroundedInfoGuideReply("que hace el historial?", "unidades");
  assert(typeof unidades === "string" && unidades.length > 0, "unidades sin API key devuelve texto estático (no vacío)");

  const mantenimiento = await buildGroundedInfoGuideReply("como registro un preventivo?", "mantenimiento");
  assert(
    typeof mantenimiento === "string" && mantenimiento.length > 0,
    "mantenimiento (sin manual PDF todavía) sigue respondiendo con la plantilla estática",
  );
} finally {
  if (originalKey) process.env.OPENAI_API_KEY = originalKey;
}

if (failed > 0) {
  console.error(`\n✗ ${failed} verificación(es) fallaron.`);
  process.exit(1);
}
console.log("\n✓ Todas las verificaciones de base de conocimiento pasaron.");
