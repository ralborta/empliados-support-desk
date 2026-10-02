#!/usr/bin/env node
/**
 * Regresión bug real 2026-09-29:
 * Cliente: «Si bueno» → Kira: «Claro. ¿Qué inconveniente se está repitiendo y con qué unidad?»
 * Debe ofrecer más ayuda, no insistir en unidad.
 *
 * Uso: npx tsx scripts/verify-si-bueno-not-unit-clarify.mjs
 */
import { looksLikeSoftSocialContinue } from "../src/lib/waraApi.ts";
import { classifyTurnExecutor } from "../src/lib/whatsappTurnRouter.ts";
import { applyPlatformGuideInterpretGuards } from "../src/lib/infoGuideInterpretAI.ts";
import { IDLE_NUDGE_MESSAGE, looksLikeIdleNudgeAffirmation } from "../src/lib/idleFollowupMeta.ts";

let failed = 0;
function assert(cond, label) {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}

const variants = ["Si bueno", "si bueno", "Ah bueno", "Si dale", "Bueno si"];
console.log("— Soft social continue —");
for (const msg of variants) {
  assert(looksLikeSoftSocialContinue(msg), `softSocial("${msg}")`);
  assert(
    classifyTurnExecutor(msg, "") === "info_guides",
    `classify("${msg}") → info_guides`,
  );
}

assert(!looksLikeSoftSocialContinue("Se sigue repitiendo el mismo inconveniente"), "!softSocial(reclamo)");
assert(!looksLikeSoftSocialContinue("M400-018 sin reporte"), "!softSocial(gps)");
assert(!looksLikeSoftSocialContinue("ZBF1418"), "!softSocial(patente)");

console.log("\n— Idle nudge reconoce Si bueno —");
const nudgeThread = `Kira: ${IDLE_NUDGE_MESSAGE}`;
assert(looksLikeIdleNudgeAffirmation("Si bueno", nudgeThread), "idleAff(Si bueno)");

console.log("\n— Guard no fuerza clarify de unidad —");
const next = applyPlatformGuideInterpretGuards(
  {
    route: "info_guides",
    guideKind: "alertas",
    need: "ambiguous",
    articleIds: ["al-panico"],
    clarifyQuestion: null,
    executionRequest: false,
    confidence: 0.9,
    reason: "test",
    category: null,
    reportId: null,
    normalTarget: null,
  },
  "Si bueno",
  "Cliente: Estado AG 562 SP\nKira: AG 562 SP detenida.",
  { lastGuideKind: "alertas", lastGuideArticleIds: ["al-panico"] },
);
assert(
  !/inconveniente se está repitiendo/i.test(next.clarifyQuestion ?? ""),
  `no DEFAULT_ISSUE_CLARIFY (got: ${next.clarifyQuestion})`,
);
assert(
  !/con qué unidad/i.test(next.clarifyQuestion ?? ""),
  "no pide unidad en clarify",
);

if (failed) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("\nOK");
