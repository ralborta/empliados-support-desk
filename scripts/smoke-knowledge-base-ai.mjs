#!/usr/bin/env node
/**
 * Smoke test manual (usa la API real de OpenAI, NO es parte del gate automático).
 * Uso: npx tsx scripts/smoke-knowledge-base-ai.mjs
 */
import { answerFromKnowledgeBase } from "../src/lib/knowledgeBaseAI.ts";

const cases = [
  ["opciones", "que es un perfil?"],
  ["opciones", "y como registro un contacto?"],
  ["unidades", "para que sirve el historial de una unidad"],
  ["unidades", "que significa el punto rojo"],
];

for (const [kind, question] of cases) {
  const answer = await answerFromKnowledgeBase(kind, question);
  console.log(`\n=== [${kind}] "${question}" ===`);
  console.log(answer ?? "(null — sin OPENAI_API_KEY o error)");
}
