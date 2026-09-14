#!/usr/bin/env node
/**
 * LIVE — Alertas KB (interpret + grounded + resolveTurnExecutor).
 *
 * NO ejecuta runTurnExecutorPhase / WhatsApp real.
 *
 * Flag off:
 *   WARA_ALERTAS_KB_ENABLED=false WARA_PLATFORM_KB_LLM_INTERPRET=true \
 *   npx tsx scripts/live-alertas-kb.mjs
 *
 * Corpus on (aislado o con otros flags):
 *   WARA_ALERTAS_KB_ENABLED=true WARA_PLATFORM_KB_LLM_INTERPRET=true \
 *   npx tsx scripts/live-alertas-kb.mjs
 *
 * Repetir ×3 en procesos separados (caché in-process no cruza procesos).
 */
import assert from "node:assert/strict";
import { interpretPlatformKnowledgeTurn } from "../src/lib/infoGuideInterpretAI.ts";
import { buildGroundedInfoGuideReplyWithMeta } from "../src/lib/infoGuideReplies.ts";
import { resolveTurnExecutor } from "../src/lib/whatsappTurnClassifierAI.ts";

if (!process.env.OPENAI_API_KEY?.trim()) {
  console.error("OPENAI_API_KEY requerida");
  process.exit(1);
}
process.env.WARA_PLATFORM_KB_LLM_INTERPRET = "true";
process.env.WARA_TURN_AI_CLASSIFY = "false";
const alCorpusOn = ["true", "1", "yes"].includes(
  String(process.env.WARA_ALERTAS_KB_ENABLED ?? "")
    .trim()
    .toLowerCase(),
);
process.env.WARA_ALERTAS_KB_ENABLED = alCorpusOn ? "true" : "false";

function assertHasArticle(ids, expectedId, label) {
  assert.ok(Array.isArray(ids), `${label}: articleIds array`);
  assert.ok(ids.length > 0, `${label}: articleIds no vacío`);
  assert.ok(ids.includes(expectedId), `${label}: esperaba ${expectedId}, got ${ids.join(",")}`);
}

const cases = [
  {
    id: "frontera-silenciar-paneles",
    text: "Quiero silenciar una alarma activa",
    expectGuide: "paneles",
    expectArticleContains: "pn-alarmas",
    onlyWhenPanelesOn: true,
    interpretOnly: true,
  },
  {
    id: "alertas-panico",
    text: "¿Dónde veo las alertas de pánico?",
    expectResolve: "info_guides",
    expectGuide: "alertas",
    expectDisabled: !alCorpusOn,
    expectArticleId: alCorpusOn ? "al-panico" : null,
    forbidOpciones: true,
  },
  {
    id: "alertas-agua-combustible",
    text: "¿Dónde veo agua en combustible en Alertas?",
    expectResolve: "info_guides",
    expectGuide: "alertas",
    expectDisabled: !alCorpusOn,
    expectArticleId: alCorpusOn ? "al-agua-combustible" : null,
    forbidGuide: "combustible",
    forbidOpciones: true,
  },
  {
    id: "frontera-protocolos-opciones",
    text: "¿Cómo configuro un protocolo de alarmas?",
    expectGuide: "opciones",
    expectCategory: "conducta_alarmas",
    expectArticlePrefix: "op-",
    onlyWhenOpcionesV2On: true,
  },
  {
    id: "frontera-informe-historico",
    text: "Informe histórico de alarmas por período",
    expectGuide: "informes",
    expectNotGuide: "alertas",
  },
  {
    id: "frontera-certificado",
    text: "necesito el certificado de cobertura de la 900173",
    expectNotGuide: "alertas",
    expectNotResolve: "info_guides",
  },
  {
    id: "frontera-odometro",
    text: "actualizar odómetro de la unidad 900173",
    expectNotGuide: "alertas",
  },
];

const panelesOn = ["true", "1", "yes"].includes(
  String(process.env.WARA_PANELES_KB_ENABLED ?? "")
    .trim()
    .toLowerCase(),
);
const opcionesV2On = ["true", "1", "yes"].includes(
  String(process.env.WARA_OPCIONES_KB_V2_ENABLED ?? "")
    .trim()
    .toLowerCase(),
);

let failed = 0;
for (const c of cases) {
  if (c.onlyWhenPanelesOn && !panelesOn) {
    console.log(`SKIP ${c.id} (paneles off)`);
    continue;
  }
  if (c.onlyWhenOpcionesV2On && !opcionesV2On) {
    console.log(`SKIP ${c.id} (opciones v2 off)`);
    continue;
  }
  await new Promise((r) => setTimeout(r, 1200));
  try {
    const interpret =
      (await interpretPlatformKnowledgeTurn({
        selectionText: c.text,
        threadText: c.thread ?? "",
      })) ??
      (await interpretPlatformKnowledgeTurn({
        selectionText: c.text,
        threadText: c.thread ?? "",
      }));
    if (!interpret && c.expectGuide) {
      throw new Error(`${c.id}: interpret null`);
    }

    if (c.interpretOnly) {
      const resolved = await resolveTurnExecutor(c.text, c.thread ?? "", null);
      if (c.expectGuide) {
        assert.equal(interpret?.guideKind, c.expectGuide, `${c.id}: guideKind`);
      }
      if (c.expectArticleContains) {
        const ids = interpret?.articleIds ?? [];
        assert.ok(ids.length > 0, `${c.id}: articleIds`);
        assert.ok(
          ids.some((id) => String(id).includes(c.expectArticleContains)),
          `${c.id}: contains ${c.expectArticleContains}`,
        );
      }
      console.log(`OK ${c.id}`, {
        guide: interpret?.guideKind,
        articles: interpret?.articleIds ?? [],
        resolve: resolved.executor,
        mode: "interpret_only",
      });
      continue;
    }

    const grounded = await buildGroundedInfoGuideReplyWithMeta(
      c.text,
      null,
      null,
      c.thread ?? "",
      interpret,
    );
    const resolved = await resolveTurnExecutor(c.text, c.thread ?? "", null);

    if (c.expectResolve) {
      assert.equal(resolved.executor, c.expectResolve, `${c.id}: resolve`);
    }
    if (c.expectNotResolve) {
      assert.notEqual(resolved.executor, c.expectNotResolve, `${c.id}: resolve`);
    }
    if (c.expectResolveWhenGuides && resolved.executor === "info_guides") {
      assert.equal(
        grounded.guideKind ?? interpret?.guideKind,
        c.expectGuide,
        `${c.id}: guide when info_guides`,
      );
    } else if (c.expectGuide) {
      assert.equal(
        grounded.guideKind ?? interpret?.guideKind,
        c.expectGuide,
        `${c.id}: guideKind`,
      );
    }
    if (c.expectNotGuide) {
      assert.notEqual(
        grounded.guideKind ?? interpret?.guideKind,
        c.expectNotGuide,
        `${c.id}: notGuide`,
      );
    }
    if (c.forbidGuide) {
      assert.notEqual(
        grounded.guideKind ?? interpret?.guideKind,
        c.forbidGuide,
        `${c.id}: forbidGuide`,
      );
    }
    if (c.expectDisabled) {
      assert.equal(grounded.fallback, "alertas_flag_off", `${c.id}: fallback`);
      assert.equal((grounded.interpret?.articleIds ?? []).length, 0, `${c.id}: articles`);
      assert.match(grounded.message, /no tengo habilitada la guía de Alertas/i);
      assert.match(grounded.message, /No te derivo a Opciones/i);
    }
    if (c.expectArticleId && alCorpusOn && resolved.executor === "info_guides") {
      const ids = grounded.interpret?.articleIds ?? interpret?.articleIds ?? [];
      assert.notEqual(grounded.fallback, "alertas_flag_off", `${c.id}: not disabled`);
      assertHasArticle(ids, c.expectArticleId, c.id);
    }
    if (c.expectArticleContains && resolved.executor === "info_guides") {
      const ids = grounded.interpret?.articleIds ?? interpret?.articleIds ?? [];
      assert.ok(ids.length > 0, `${c.id}: articleIds`);
      assert.ok(
        ids.some((id) => String(id).includes(c.expectArticleContains)),
        `${c.id}: contains ${c.expectArticleContains}`,
      );
    }
    if (c.expectArticlePrefix && resolved.executor === "info_guides") {
      const ids = grounded.interpret?.articleIds ?? interpret?.articleIds ?? [];
      assert.ok(ids.length > 0, `${c.id}: articleIds`);
      assert.ok(
        ids.some((id) => String(id).startsWith(c.expectArticlePrefix) && !String(id).includes("idx")),
        `${c.id}: detalle ${c.expectArticlePrefix}*`,
      );
    }
    if (c.expectCategory && resolved.executor === "info_guides") {
      assert.equal(
        grounded.interpret?.category ?? interpret?.category,
        c.expectCategory,
        `${c.id}: category`,
      );
    }
    if (c.forbidOpciones) {
      assert.notEqual(grounded.guideKind, "opciones", `${c.id}: no opciones`);
      assert.doesNotMatch(
        grounded.message,
        /Opciones\s*[→\-]\s*Notificaciones/i,
        `${c.id}: no blob opciones`,
      );
    }

    console.log(`OK ${c.id}`, {
      guide: grounded.guideKind,
      fallback: grounded.fallback,
      category: grounded.interpret?.category ?? null,
      reportId: grounded.interpret?.reportId ?? null,
      articles: grounded.interpret?.articleIds ?? [],
      resolve: resolved.executor,
    });
  } catch (err) {
    failed += 1;
    console.error(`FAIL ${c.id}`, err instanceof Error ? err.message : err);
  }
}

// Continuidad: follow-up conserva artículo detallado
if (alCorpusOn) {
  try {
    const first = await interpretPlatformKnowledgeTurn({
      selectionText: "¿Dónde veo las alertas de pánico?",
      threadText: "",
    });
    assertHasArticle(first?.articleIds ?? [], "al-panico", "continuity-first");
    const follow = await interpretPlatformKnowledgeTurn({
      selectionText: "¿y qué puedo ver ahí?",
      threadText: "Usuario: ¿Dónde veo las alertas de pánico?\nBot: Guía Alertas pánico.",
      lastGuideKind: "alertas",
      lastGuideReportId: first?.reportId ?? "panico",
      lastGuideArticleIds: first?.articleIds ?? ["al-panico"],
    });
    assert.equal(follow?.guideKind, "alertas", "continuity guide");
    assertHasArticle(follow?.articleIds ?? [], "al-panico", "continuity-follow");
    console.log("OK continuity-alertas-panico", { articles: follow?.articleIds });
  } catch (err) {
    failed += 1;
    console.error("FAIL continuity-alertas-panico", err instanceof Error ? err.message : err);
  }
}

console.log({ alertasCorpus: alCorpusOn, failed });
if (failed) {
  console.error(`live-alertas-kb: ${failed} failed`);
  process.exit(1);
}
console.log("OK live-alertas-kb");
