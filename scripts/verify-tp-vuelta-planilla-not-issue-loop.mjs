#!/usr/bin/env node
/**
 * Regresión bug real 2026-09-29 (Maxi / Planilla de Horarios):
 * Cliente: «necesito eliminar una vuelta de Planilla de Horarios»
 * Kira: «¿Qué inconveniente específico tienes con la vuelta…?» (loop)
 * Cliente: «Tengo una vuelta repetida» / «Eliminar…» → misma pregunta.
 *
 * Esperado: guía TP execute (límite de canal + turno), sin repreguntar inconveniente.
 *
 * Uso: npx tsx scripts/verify-tp-vuelta-planilla-not-issue-loop.mjs
 */
import assert from "node:assert/strict";
import { classifyTurnExecutor } from "../src/lib/whatsappTurnRouter.ts";
import {
  looksLikeTransportePublicoVueltaPlanillaRequest,
  looksLikePlanillaVueltaIssueClarifyFollowup,
  threadBotAskedPlanillaVueltaIssueClarify,
  looksLikeTransportePublicoVueltaPlanillaGuideTurn,
} from "../src/lib/transportePublicoKnowledge.ts";
import { applyPlatformGuideInterpretGuards } from "../src/lib/infoGuideInterpretAI.ts";

const open =
  "Hola Kira, necesito eliminar una vuelta de Planilla de Horarios";
assert.equal(
  looksLikeTransportePublicoVueltaPlanillaRequest(open),
  true,
  "detecta eliminar vuelta + planilla",
);
assert.equal(classifyTurnExecutor(open, ""), "info_guides");

const clarifyThread = [
  `Cliente: ${open}`,
  "Kira: ¿Qué inconveniente específico tienes con la vuelta de la Planilla de Horarios?",
].join("\n");
assert.equal(
  threadBotAskedPlanillaVueltaIssueClarify(clarifyThread),
  true,
  "detecta clarify específico de planilla",
);

for (const follow of [
  "Tengo una vuelta repetida.",
  "Eliminar una vuelta perdida.",
  "Perdón, vuelta repetida.",
]) {
  assert.equal(
    looksLikePlanillaVueltaIssueClarifyFollowup(follow, clarifyThread),
    true,
    `followup: ${follow}`,
  );
  assert.equal(
    looksLikeTransportePublicoVueltaPlanillaGuideTurn(follow, clarifyThread),
    true,
  );
  assert.equal(classifyTurnExecutor(follow, clarifyThread), "info_guides");

  const guarded = applyPlatformGuideInterpretGuards(
    {
      route: "info_guides",
      guideKind: "informes",
      need: "ambiguous",
      articleIds: ["inf-tp-planilla-horarios"],
      clarifyQuestion:
        "¿Qué inconveniente específico tienes con la vuelta de la Planilla de Horarios?",
      executionRequest: false,
      confidence: 0.9,
      reason: "llm",
      category: "transporte_pasajeros",
      reportId: "inf-tp-planilla-horarios",
      normalTarget: null,
    },
    follow,
    clarifyThread,
    { lastGuideKind: "informes" },
  );
  assert.equal(guarded.guideKind, "transporte_publico", `guide TP (${follow})`);
  assert.equal(guarded.need, "execute", `need execute (${follow})`);
  assert.equal(guarded.executionRequest, true);
  assert.equal(guarded.clarifyQuestion, null, `sin clarify (${follow})`);
  assert.ok(
    guarded.articleIds.includes("tp-ejecucion-no-disponible"),
    "incluye límite de ejecución",
  );
  assert.ok(guarded.articleIds.includes("tp-turno-crear"), "incluye guía de turno");
  assert.doesNotMatch(
    guarded.clarifyQuestion ?? "",
    /inconveniente/i,
    "no repregunta inconveniente",
  );
}

const openGuarded = applyPlatformGuideInterpretGuards(
  {
    route: "info_guides",
    guideKind: null,
    need: "ambiguous",
    articleIds: [],
    clarifyQuestion: null,
    executionRequest: false,
    confidence: 0.5,
    reason: "llm",
    category: null,
    reportId: null,
    normalTarget: null,
  },
  open,
  "",
  {},
);
assert.equal(openGuarded.guideKind, "transporte_publico");
assert.equal(openGuarded.need, "execute");
assert.equal(openGuarded.clarifyQuestion, null);

// Negativos: no secuestrar GPS/etapas ni «vuelta» suelta sin planilla.
assert.equal(
  looksLikeTransportePublicoVueltaPlanillaRequest("etapas de la vuelta AG 562 SP"),
  false,
);
assert.equal(
  looksLikePlanillaVueltaIssueClarifyFollowup("Tengo una vuelta repetida.", ""),
  false,
  "sin clarify previo no es followup",
);
assert.equal(
  classifyTurnExecutor("Tengo una vuelta repetida.", ""),
  "unidades",
  "vuelta repetida suelta no fuerza TP",
);

console.log("OK verify-tp-vuelta-planilla-not-issue-loop");
