#!/usr/bin/env node
/**
 * LIVE LLM — evidencia de interpretación + artículos + respuesta (NO envía WhatsApp).
 * No forma parte del gate pre-push.
 *
 * Uso: npx tsx scripts/live-transporte-publico-kb.mjs
 */
import { interpretPlatformKnowledgeTurn } from "../src/lib/infoGuideInterpretAI.ts";
import { buildGroundedInfoGuideReplyWithMeta } from "../src/lib/infoGuideReplies.ts";

if (!process.env.OPENAI_API_KEY?.trim()) {
  console.error("OPENAI_API_KEY requerida");
  process.exit(1);
}
process.env.WARA_PLATFORM_KB_LLM_INTERPRET = "true";

const cases = [
  {
    id: "def-hoja",
    text: "¿Qué es una hoja de turno?",
    thread: "",
  },
  {
    id: "proc-hoja",
    text: "¿Cómo hago una hoja de turno?",
    thread: "",
  },
  {
    id: "trouble-manana",
    text: "No puedo crear la hoja para mañana",
    thread: "",
  },
  {
    id: "trouble-color",
    text: "El colectivo no aparece con color",
    thread: "",
  },
  {
    id: "execute",
    text: "Creame la hoja de turno",
    thread: "",
  },
  {
    id: "ambiguous",
    text: "Necesito ayuda con transporte",
    thread: "",
  },
  {
    id: "followup-feriado",
    text: "¿Y si es feriado?",
    thread:
      "Cliente: ¿Cómo creo una hoja de turno?\nBot: Para crear la hoja de turno andá a Utilidades → Transporte de Pasajeros → Hoja de Turnos…",
  },
  {
    id: "regresion-perfil",
    text: "qué es un perfil?",
    thread: "",
  },
];

const evidence = [];

for (const c of cases) {
  await new Promise((r) => setTimeout(r, 800));
  let interpret = await interpretPlatformKnowledgeTurn({
    selectionText: c.text,
    threadText: c.thread,
  });
  if (!interpret) {
    await new Promise((r) => setTimeout(r, 1200));
    interpret = await interpretPlatformKnowledgeTurn({
      selectionText: c.text,
      threadText: c.thread,
    });
  }
  const { message, guideKind, interpret: used } = await buildGroundedInfoGuideReplyWithMeta(
    c.text,
    null,
    null,
    c.thread,
    interpret,
  );
  const row = {
    id: c.id,
    text: c.text,
    interpret,
    guideKind,
    usedNeed: used?.need ?? null,
    usedArticles: used?.articleIds ?? [],
    replyPreview: message.slice(0, 280),
    replyLen: message.length,
  };
  evidence.push(row);
  console.log("\n========", c.id, "========");
  console.log("interpret:", JSON.stringify(interpret, null, 2));
  console.log("guideKind:", guideKind);
  console.log("reply:\n", message);
}

console.log("\n\n=== EVIDENCIA JSON ===");
console.log(JSON.stringify(evidence, null, 2));
