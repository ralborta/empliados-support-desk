#!/usr/bin/env node
/**
 * Regresión bug real 2026-09-29:
 * Kira: «¿Qué inconveniente… y con qué unidad?»
 * Cliente: «Que inconveniente?»
 * Antes: tutorial de armar servicio en Transporte Público.
 * Ahora: disculpa + pedir en qué ayudar.
 *
 * Uso: npx tsx scripts/verify-que-inconveniente-pushback.mjs
 */
import {
  looksLikeAmbiguousIssueClarifyPushback,
  buildAmbiguousIssueClarifyPushbackReply,
  threadBotAskedAmbiguousIssueClarify,
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

const thread = [
  "Cliente: Si bueno",
  "Kira: Claro. ¿Qué inconveniente se está repitiendo y con qué unidad?",
].join("\n");

const msg = "Que inconveniente?";

console.log("— Detección —");
assert(threadBotAskedAmbiguousIssueClarify(thread), "thread tiene clarify vago");
assert(looksLikeAmbiguousIssueClarifyPushback(msg, thread), `pushback("${msg}")`);
assert(
  looksLikeAmbiguousIssueClarifyPushback("a que te referis", thread),
  "pushback(a que te referis)",
);
assert(
  !looksLikeAmbiguousIssueClarifyPushback(msg, "Cliente: hola\nKira: ¿En qué te ayudo?"),
  "sin clarify previo no es pushback",
);
assert(
  !looksLikeAmbiguousIssueClarifyPushback("Cómo cargo un servicio nuevo", thread),
  "how-to TP real no es pushback",
);

console.log("\n— Routing —");
assert(
  classifyTurnExecutor(msg, thread) === "info_guides",
  `classify → info_guides (got ${classifyTurnExecutor(msg, thread)})`,
);

console.log("\n— Guard no dump TP —");
const next = applyPlatformGuideInterpretGuards(
  {
    route: "info_guides",
    guideKind: "transporte_publico",
    need: "procedure",
    articleIds: ["tp-servicio-crear"],
    clarifyQuestion: null,
    executionRequest: false,
    confidence: 0.95,
    reason: "llm_tp",
    category: null,
    reportId: null,
    normalTarget: null,
  },
  msg,
  thread,
  { lastGuideKind: "transporte_publico", lastGuideArticleIds: ["tp-conceptos-pilares"] },
);
assert(next.guideKind === null, `guideKind null (got ${next.guideKind})`);
assert(next.articleIds.length === 0, "sin articles TP");
assert(
  /perdon|adelant|ayud/i.test(next.clarifyQuestion ?? ""),
  `disculpa (got: ${next.clarifyQuestion})`,
);
assert(
  !/servicio desde cero|Transporte Público/i.test(next.clarifyQuestion ?? ""),
  "no tutorial TP",
);
assert(
  next.reason?.includes("ambiguous_issue_pushback"),
  `reason pushback (got ${next.reason})`,
);

const reply = buildAmbiguousIssueClarifyPushbackReply();
assert(/Perdón|ayud/i.test(reply), `reply suave: ${reply}`);

if (failed) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("\nOK");
