#!/usr/bin/env node
/**
 * LIVE — Paneles KB (interpret + grounded + resolveTurnExecutor).
 *
 * Flag off / on — repetir ×3 en procesos separados.
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
const pnCorpusOn = ["true", "1", "yes"].includes(
  String(process.env.WARA_PANELES_KB_ENABLED ?? "")
    .trim()
    .toLowerCase(),
);
process.env.WARA_PANELES_KB_ENABLED = pnCorpusOn ? "true" : "false";

function assertHasArticle(ids, expectedId, label) {
  assert.ok(Array.isArray(ids), `${label}: articleIds array`);
  assert.ok(ids.length > 0, `${label}: articleIds no vacío`);
  assert.ok(ids.includes(expectedId), `${label}: esperaba ${expectedId}, got ${ids.join(",")}`);
}

const cases = [
  {
    id: "paneles-resolver-alarma",
    text: "Quiero resolver una alarma",
    expectResolve: "info_guides",
    expectGuide: "paneles",
    expectDisabled: !pnCorpusOn,
    expectArticleId: pnCorpusOn ? "pn-alarmas" : null,
    forbidOpciones: true,
    interpretOnly: true,
  },
  {
    id: "paneles-turnos",
    text: "¿Cómo consulto el panel de Turnos?",
    expectResolve: "info_guides",
    expectGuide: "paneles",
    expectDisabled: !pnCorpusOn,
    expectArticleId: pnCorpusOn ? "pn-turnos" : null,
    forbidOpciones: true,
  },
  {
    id: "paneles-notificaciones",
    text: "¿Dónde veo las notificaciones recientes en Paneles?",
    expectResolve: "info_guides",
    expectGuide: "paneles",
    expectDisabled: !pnCorpusOn,
    expectArticleId: pnCorpusOn ? "pn-notificaciones" : null,
    forbidOpciones: true,
  },
  {
    id: "frontera-informe-turnos",
    text: "Informe de turnos de choferes",
    expectGuide: "informes",
    expectNotGuide: "paneles",
  },
  {
    id: "frontera-certificado",
    text: "necesito el certificado de cobertura de la 900173",
    expectNotGuide: "paneles",
    expectNotResolve: "info_guides",
  },
  {
    id: "frontera-odometro",
    text: "actualizar odómetro de la unidad 900173",
    expectNotGuide: "paneles",
  },
];

let failed = 0;
for (const c of cases) {
  await new Promise((r) => setTimeout(r, 900));
  try {
    let interpret = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      interpret = await interpretPlatformKnowledgeTurn({
        selectionText: c.text,
        threadText: "",
      });
      if (
        interpret?.guideKind === c.expectGuide &&
        (!c.expectArticleId ||
          !pnCorpusOn ||
          (interpret.articleIds ?? []).includes(c.expectArticleId))
      ) {
        break;
      }
      await new Promise((r) => setTimeout(r, 700));
    }
    if (!interpret && c.expectGuide) {
      throw new Error(`${c.id}: interpret null`);
    }

    if (c.interpretOnly) {
      const resolved = await resolveTurnExecutor(c.text, "", null);
      if (c.expectGuide) {
        assert.equal(interpret?.guideKind, c.expectGuide, `${c.id}: guideKind`);
      }
      if (c.expectArticleId && pnCorpusOn) {
        assertHasArticle(interpret?.articleIds ?? [], c.expectArticleId, c.id);
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
      "",
      interpret,
    );
    const resolved = await resolveTurnExecutor(c.text, "", null);

    if (c.expectResolve) {
      assert.equal(resolved.executor, c.expectResolve, `${c.id}: resolve`);
    }
    if (c.expectNotResolve) {
      assert.notEqual(resolved.executor, c.expectNotResolve, `${c.id}: resolve`);
    }
    if (c.expectGuide) {
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
    if (c.expectDisabled) {
      assert.equal(grounded.fallback, "paneles_flag_off", `${c.id}: fallback`);
      assert.equal((grounded.interpret?.articleIds ?? []).length, 0, `${c.id}: articles`);
      assert.match(grounded.message, /no tengo habilitada la guía de Paneles/i);
    }
    if (c.expectArticleId && pnCorpusOn && resolved.executor === "info_guides") {
      const ids = grounded.interpret?.articleIds ?? interpret?.articleIds ?? [];
      assert.notEqual(grounded.fallback, "paneles_flag_off", `${c.id}: not disabled`);
      assertHasArticle(ids, c.expectArticleId, c.id);
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
      reportId: grounded.interpret?.reportId ?? null,
      articles: grounded.interpret?.articleIds ?? [],
      resolve: resolved.executor,
    });
  } catch (err) {
    failed += 1;
    console.error(`FAIL ${c.id}`, err instanceof Error ? err.message : err);
  }
}

if (pnCorpusOn) {
  try {
    const first = await interpretPlatformKnowledgeTurn({
      selectionText: "¿Cómo consulto el panel de Turnos?",
      threadText: "",
    });
    assertHasArticle(first?.articleIds ?? [], "pn-turnos", "continuity-first");
    const follow = await interpretPlatformKnowledgeTurn({
      selectionText: "¿y qué puedo hacer ahí?",
      threadText: "Usuario: ¿Cómo consulto el panel de Turnos?\nBot: Guía panel Turnos.",
      lastGuideKind: "paneles",
      lastGuideReportId: first?.reportId ?? "turnos",
      lastGuideArticleIds: first?.articleIds ?? ["pn-turnos"],
    });
    assert.equal(follow?.guideKind, "paneles", "continuity guide");
    assertHasArticle(follow?.articleIds ?? [], "pn-turnos", "continuity-follow");
    console.log("OK continuity-paneles-turnos", { articles: follow?.articleIds });
  } catch (err) {
    failed += 1;
    console.error("FAIL continuity-paneles-turnos", err instanceof Error ? err.message : err);
  }
}

console.log({ panelesCorpus: pnCorpusOn, failed });
if (failed) {
  console.error(`live-paneles-kb: ${failed} failed`);
  process.exit(1);
}
console.log("OK live-paneles-kb");
