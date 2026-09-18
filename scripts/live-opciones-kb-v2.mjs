#!/usr/bin/env node
/**
 * LIVE — Opciones KB V2.
 *
 * V2 off (legacy):
 *   WARA_OPCIONES_KB_V2_ENABLED=false WARA_PLATFORM_KB_LLM_INTERPRET=true \
 *   npx tsx scripts/live-opciones-kb-v2.mjs
 *
 * V2 on:
 *   WARA_OPCIONES_KB_V2_ENABLED=true WARA_OPCIONES_KB_SECTIONS=atributos,personas_accesos_empresas,transporte_pasajeros,hojas_ruta,comunicaciones_notificaciones,conducta_alarmas,combustible,mantenimiento_deposito,informes_envios_programados \
 *   WARA_PLATFORM_KB_LLM_INTERPRET=true npx tsx scripts/live-opciones-kb-v2.mjs
 *
 * Repetir ×3 en procesos separados.
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
const v2On = ["true", "1", "yes"].includes(
  String(process.env.WARA_OPCIONES_KB_V2_ENABLED ?? "")
    .trim()
    .toLowerCase(),
);
process.env.WARA_OPCIONES_KB_V2_ENABLED = v2On ? "true" : "false";
if (v2On && !process.env.WARA_OPCIONES_KB_SECTIONS?.trim()) {
  process.env.WARA_OPCIONES_KB_SECTIONS =
    "atributos,personas_accesos_empresas,transporte_pasajeros,hojas_ruta,comunicaciones_notificaciones,conducta_alarmas,combustible,mantenimiento_deposito,informes_envios_programados";
}

function assertHasArticle(ids, expectedId, label) {
  assert.ok(Array.isArray(ids), `${label}: articleIds array`);
  assert.ok(ids.length > 0, `${label}: articleIds no vacío`);
  assert.ok(ids.includes(expectedId), `${label}: esperaba ${expectedId}, got ${ids.join(",")}`);
}

function assertDetailOp(ids, label) {
  assert.ok(Array.isArray(ids) && ids.length > 0, `${label}: articleIds`);
  const detail = ids.find(
    (id) =>
      String(id).startsWith("op-") &&
      !String(id).startsWith("op-idx-") &&
      id !== "op-mapa" &&
      id !== "op-restricciones",
  );
  assert.ok(detail, `${label}: detalle op-*, got ${ids.join(",")}`);
  return detail;
}

const cases = v2On
  ? [
      {
        id: "opciones-stock-diario",
        text: "¿Cómo configuro stock diario en Opciones?",
        expectResolve: "info_guides",
        expectGuide: "opciones",
        expectCategory: "informes_envios_programados",
        expectArticleId: "op-stock-diario",
        retries: 4,
      },
      {
        id: "opciones-protocolos",
        text: "¿Cómo configuro protocolos de alarmas?",
        expectResolve: "info_guides",
        expectGuide: "opciones",
        expectCategory: "conducta_alarmas",
        expectDetailOp: true,
      },
      {
        id: "opciones-notificaciones",
        text: "¿Dónde configuro notificaciones en Opciones?",
        expectResolve: "info_guides",
        expectGuide: "opciones",
        expectCategory: "comunicaciones_notificaciones",
        expectDetailOp: true,
      },
      {
        id: "frontera-silenciar-paneles",
        text: "Quiero silenciar una alarma en Paneles",
        expectNotGuide: "opciones",
        expectGuidePrefer: "paneles",
      },
      {
        id: "frontera-cargar-combustible",
        text: "Quiero cargar combustible",
        expectNotGuide: "opciones",
        // Trámite operativo: no Opciones; executor puede ser combustible/u otro no-KB.
        forbidOpcionesResolve: true,
      },
    ]
  : [
      {
        id: "opciones-legacy",
        text: "Explicame el módulo Opciones / agenda",
        expectGuide: "opciones",
        expectResolve: "info_guides",
        forbidDisabledWording: true,
      },
      {
        id: "agenda-legacy",
        text: "cómo configuro la agenda en Wara",
        expectGuide: "opciones",
        forbidDisabledWording: true,
      },
    ];

let failed = 0;
for (const c of cases) {
  await new Promise((r) => setTimeout(r, 700));
  try {
    let interpret = null;
    let grounded = null;
    let resolved = null;
    const attempts = c.retries ?? 1;
    for (let attempt = 0; attempt < attempts; attempt++) {
      interpret = await interpretPlatformKnowledgeTurn({
        selectionText: c.text,
        threadText: "",
      });
      grounded = await buildGroundedInfoGuideReplyWithMeta(
        c.text,
        null,
        null,
        "",
        interpret,
      );
      resolved = await resolveTurnExecutor(c.text, "", null);
      const cat = grounded?.interpret?.category ?? interpret?.category;
      const ids = grounded?.interpret?.articleIds ?? interpret?.articleIds ?? [];
      const okCat = !c.expectCategory || cat === c.expectCategory;
      const okArt = !c.expectArticleId || ids.includes(c.expectArticleId);
      if (okCat && okArt) break;
      await new Promise((r) => setTimeout(r, 600));
    }

    if (c.expectResolve) {
      assert.equal(resolved.executor, c.expectResolve, `${c.id}: resolve`);
    }
    if (c.expectNotResolve) {
      assert.notEqual(resolved.executor, c.expectNotResolve, `${c.id}: resolve`);
    }
    if (c.forbidOpcionesResolve) {
      assert.notEqual(
        grounded.guideKind ?? interpret?.guideKind,
        "opciones",
        `${c.id}: no opciones`,
      );
    }
    if (c.expectGuide) {
      assert.equal(
        grounded.guideKind ?? interpret?.guideKind,
        c.expectGuide,
        `${c.id}: guide`,
      );
    }
    if (c.expectGuidePrefer) {
      const gk = grounded.guideKind ?? interpret?.guideKind;
      if (resolved.executor === "info_guides") {
        assert.equal(gk, c.expectGuidePrefer, `${c.id}: prefer guide`);
      } else {
        assert.notEqual(gk, "opciones", `${c.id}: not opciones`);
      }
    }
    if (c.expectNotGuide) {
      assert.notEqual(
        grounded.guideKind ?? interpret?.guideKind,
        c.expectNotGuide,
        `${c.id}: notGuide`,
      );
    }
    if (c.expectCategory && resolved.executor === "info_guides") {
      assert.equal(
        grounded.interpret?.category ?? interpret?.category,
        c.expectCategory,
        `${c.id}: category`,
      );
    }
    if (c.expectArticleId && resolved.executor === "info_guides") {
      const ids = grounded.interpret?.articleIds ?? interpret?.articleIds ?? [];
      assertHasArticle(ids, c.expectArticleId, c.id);
    }
    if (c.expectDetailOp && resolved.executor === "info_guides") {
      const ids = grounded.interpret?.articleIds ?? interpret?.articleIds ?? [];
      assertDetailOp(ids, c.id);
    }
    if (c.forbidDisabledWording) {
      assert.doesNotMatch(
        grounded.message,
        /deshabilitad|guía V2 todavía no/i,
        `${c.id}: legacy wording`,
      );
    }

    console.log(`OK ${c.id}`, {
      guide: grounded.guideKind,
      fallback: grounded.fallback,
      category: grounded.interpret?.category ?? null,
      articles: grounded.interpret?.articleIds ?? [],
      resolve: resolved.executor,
    });
  } catch (err) {
    failed += 1;
    console.error(`FAIL ${c.id}`, err instanceof Error ? err.message : err);
  }
}

if (v2On) {
  try {
    const first = await interpretPlatformKnowledgeTurn({
      selectionText: "¿Cómo configuro protocolos de alarmas?",
      threadText: "",
    });
    assert.equal(first?.guideKind, "opciones");
    assert.equal(first?.category, "conducta_alarmas");
    const detail = assertDetailOp(first?.articleIds ?? [], "continuity-first");
    const follow = await interpretPlatformKnowledgeTurn({
      selectionText: "¿y qué campos tiene?",
      threadText: "Usuario: protocolos de alarmas\nBot: Guía protocolos.",
      lastGuideKind: "opciones",
      lastGuideCategory: "conducta_alarmas",
      lastGuideReportId: first?.reportId ?? null,
      lastGuideArticleIds: first?.articleIds ?? [detail],
    });
    assert.equal(follow?.guideKind, "opciones");
    assert.equal(follow?.category, "conducta_alarmas");
    assertDetailOp(follow?.articleIds ?? [], "continuity-follow");
    console.log("OK continuity-opciones-protocolos", { articles: follow?.articleIds });
  } catch (err) {
    failed += 1;
    console.error(
      "FAIL continuity-opciones-protocolos",
      err instanceof Error ? err.message : err,
    );
  }
}

console.log({ opcionesV2: v2On, failed });
if (failed) {
  console.error(`live-opciones-kb-v2: ${failed} failed`);
  process.exit(1);
}
console.log("OK live-opciones-kb-v2");
