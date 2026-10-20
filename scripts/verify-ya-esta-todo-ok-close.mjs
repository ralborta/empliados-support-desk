#!/usr/bin/env node
/**
 * Regresión bug real 2026-09-30:
 * Cliente: «ya esta todo ok!»
 * Antes: «No puedo ayudarte… cargar un servicio nuevo» (TP).
 * Ahora: cierre agradecido.
 *
 * Uso: npx tsx scripts/verify-ya-esta-todo-ok-close.mjs
 */
import {
  looksLikeAllGoodResolutionAck,
  buildAllGoodResolutionAckReply,
} from "../src/lib/waraApi.ts";
import { classifyTurnExecutor } from "../src/lib/whatsappTurnRouter.ts";
import { applyPlatformGuideInterpretGuards } from "../src/lib/infoGuideInterpretAI.ts";

let failed = 0;
function assert(cond, label) {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}

const variants = [
  "ya esta todo ok!",
  "Ya está todo ok!",
  "todo ok",
  "todo bien",
  "ya quedo",
  "ya esta",
  "listo ya esta",
];

console.log("— Detección —");
for (const msg of variants) {
  assert(looksLikeAllGoodResolutionAck(msg), `allGood("${msg}")`);
  assert(
    classifyTurnExecutor(msg, "") === "info_guides",
    `classify("${msg}") → info_guides`,
  );
}
assert(!looksLikeAllGoodResolutionAck("Cómo cargo un servicio nuevo"), "!allGood(howto)");
assert(!looksLikeAllGoodResolutionAck("M400-018 sin reporte"), "!allGood(gps)");

console.log("\n— Guard no dump TP —");
const thread =
  "Cliente: Como cargo un servicio\nKira: Para armar un servicio desde cero…";
const next = applyPlatformGuideInterpretGuards(
  {
    route: "info_guides",
    guideKind: "transporte_publico",
    need: "procedure",
    articleIds: ["tp-servicio-crear"],
    clarifyQuestion: "No puedo ayudarte con eso…",
    executionRequest: false,
    confidence: 0.9,
    reason: "llm",
    category: null,
    reportId: null,
    normalTarget: null,
  },
  "ya esta todo ok!",
  thread,
  { lastGuideKind: "transporte_publico", lastGuideArticleIds: ["tp-servicio-crear"] },
);
assert(next.guideKind === null, `guideKind null (got ${next.guideKind})`);
assert(next.articleIds.length === 0, "sin articles");
assert(
  /genial|alegra|avisame/i.test(next.clarifyQuestion ?? ""),
  `cierre agradecido (got: ${next.clarifyQuestion})`,
);
assert(!/no puedo|servicio nuevo/i.test(next.clarifyQuestion ?? ""), "no rechazo TP");
assert(next.reason?.includes("all_good_resolution_ack"), `reason (got ${next.reason})`);
assert(/Genial|alegra/i.test(buildAllGoodResolutionAckReply()), "reply builder");

if (failed) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("\nOK");
