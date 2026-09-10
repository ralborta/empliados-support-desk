#!/usr/bin/env node
/**
 * LIVE — Puntos de interés KB (interpret + grounded + resolveTurnExecutor).
 *
 * NO ejecuta runTurnExecutorPhase / WhatsApp real.
 *
 * Uso (flag PI off — contrato safe-off):
 *   WARA_PUNTOS_INTERES_KB_ENABLED=false WARA_PLATFORM_KB_LLM_INTERPRET=true \
 *   npx tsx scripts/live-puntos-interes-kb.mjs
 *
 * Corpus on:
 *   WARA_PUNTOS_INTERES_KB_ENABLED=true WARA_PLATFORM_KB_LLM_INTERPRET=true \
 *   npx tsx scripts/live-puntos-interes-kb.mjs
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
const piCorpusOn = ["true", "1", "yes"].includes(
  String(process.env.WARA_PUNTOS_INTERES_KB_ENABLED ?? "")
    .trim()
    .toLowerCase(),
);
process.env.WARA_PUNTOS_INTERES_KB_ENABLED = piCorpusOn ? "true" : "false";

const PI_THREAD =
  "Cliente: ¿Cómo creo un punto de interés?\n" +
  "Atilio: En Utilidades → Puntos de interés podés agregar un punto en un grupo.";

const cases = [
  {
    id: "module-pi",
    text: "módulo de puntos de interes",
    thread: "",
    expectResolve: "info_guides",
    expectGuide: "puntos_de_interes",
    expectDisabled: !piCorpusOn,
  },
  {
    id: "create-pi",
    text: "¿Cómo creo un punto de interés?",
    thread: "",
    expectResolve: "info_guides",
    expectGuide: "puntos_de_interes",
    expectDisabled: !piCorpusOn,
  },
  {
    id: "follow-pi",
    text: "¿Y después cómo edito ese punto de interés?",
    thread: PI_THREAD,
    expectResolve: "info_guides",
    expectGuide: "puntos_de_interes",
    expectDisabled: !piCorpusOn,
  },
  {
    id: "deposito-pi",
    text: "qué es el tipo Depósito en puntos de interés",
    thread: "",
    expectResolve: "info_guides",
    expectGuide: "puntos_de_interes",
    expectDisabled: !piCorpusOn,
  },
  {
    id: "etapas-servicio-tp",
    text: "cómo agrego etapas al servicio de transporte",
    thread: "",
    expectResolve: "info_guides",
    expectGuide: "transporte_publico",
    expectTpPoiLink: true,
  },
  {
    id: "asignar-poi-linea-tp",
    text: "¿Cómo asigno un punto de interés a una línea?",
    thread: "",
    expectResolve: "info_guides",
    expectGuide: "transporte_publico",
    expectTpPoiLink: true,
  },
  {
    id: "poi-al-servicio-tp",
    text: "¿Cómo agrego un POI al servicio?",
    thread: "",
    expectResolve: "info_guides",
    expectGuide: "transporte_publico",
    expectTpPoiLink: true,
  },
  {
    id: "punto-a-linea-tp",
    text: "¿Cómo asigno un punto a una línea?",
    thread: "",
    expectResolve: "info_guides",
    expectGuide: "transporte_publico",
    expectTpPoiLink: true,
  },
  {
    id: "checkpoints-recorrido-tp",
    text: "¿Dónde cargo los checkpoints del recorrido?",
    thread: "",
    expectResolve: "info_guides",
    expectGuide: "transporte_publico",
    expectTpPoiLink: true,
  },
  {
    id: "punto-grupo-pi",
    text: "¿Cómo agrego un punto al grupo Clientes?",
    thread: "",
    expectResolve: "info_guides",
    expectGuide: "puntos_de_interes",
    expectDisabled: !piCorpusOn,
  },
  {
    id: "parada-tp",
    text: "cómo creo una parada de pasajeros",
    thread: "",
    expectResolve: "info_guides",
    expectGuide: "transporte_publico",
  },
  {
    id: "hoja-turno-tp",
    text: "cómo creo una hoja de turno",
    thread: "",
    expectResolve: "info_guides",
    expectGuide: "transporte_publico",
  },
  {
    id: "execute-pi",
    text: "Creame un punto de interés en mi cuenta",
    thread: "",
    expectResolve: "info_guides",
    expectGuide: "puntos_de_interes",
    expectExecuteOrDisabled: true,
  },
  {
    id: "odo",
    text: "Quiero corregir el odómetro",
    thread: "",
    expectResolve: "odometro",
  },
];

let failed = 0;

console.log(
  JSON.stringify({
    mode: piCorpusOn ? "corpus_on" : "flag_off_safe",
    interpret: true,
  }),
);

for (const c of cases) {
  await new Promise((r) => setTimeout(r, 700));
  const resolved = await resolveTurnExecutor(c.text, c.thread || c.text);
  let guideKind = null;
  let used = null;
  let fallback = null;
  let replyPreview = "";
  if (resolved.executor === "info_guides") {
    const interpret = await interpretPlatformKnowledgeTurn({
      selectionText: c.text,
      threadText: c.thread,
    });
    const meta = await buildGroundedInfoGuideReplyWithMeta(
      c.text,
      null,
      null,
      c.thread,
      interpret,
    );
    guideKind = meta.guideKind;
    used = meta.interpret;
    fallback = meta.fallback;
    replyPreview = String(meta.message).slice(0, 280);
  }

  const row = {
    id: c.id,
    resolvedExecutor: resolved.executor,
    guideKind,
    need: used?.need ?? null,
    articleIds: used?.articleIds ?? [],
    fallback,
    confidence: used?.confidence ?? null,
    executionRequest: used?.executionRequest ?? null,
    replyPreview,
  };
  console.log(JSON.stringify(row));

  try {
    if (c.expectResolve) assert.equal(resolved.executor, c.expectResolve, `${c.id} resolve`);
    if (c.expectGuide) assert.equal(guideKind, c.expectGuide, `${c.id} guide`);
    if (c.expectTpPoiLink) {
      assert.ok(
        (used?.articleIds ?? []).some((id) => id === "tp-poi-crear") ||
          /puntos? de inter[eé]s|POI|checkpoint|etapa/i.test(replyPreview),
        `${c.id} TP reply links POI/etapas`,
      );
      assert.notEqual(fallback, "puntos_interes_flag_off", `${c.id} not PI disabled`);
    }
    if (c.expectDisabled) {
      assert.equal(fallback, "puntos_interes_flag_off", `${c.id} disabled fallback`);
      assert.equal((used?.articleIds ?? []).length, 0, `${c.id} no pi-* bodies`);
      assert.match(replyPreview, /no tengo habilitada|Puntos de interés/i, `${c.id} disabled msg`);
      assert.doesNotMatch(replyPreview, /etapas ≠|etapas !=/i, `${c.id} no false frontier`);
    }
    if (c.expectExecuteOrDisabled) {
      if (piCorpusOn) {
        assert.ok(
          used?.executionRequest === true ||
            used?.need === "execute" ||
            (used?.articleIds ?? []).includes("pi-ejecucion-no-disponible") ||
            /no puedo crear|WhatsApp/i.test(replyPreview),
          `${c.id} execute limit`,
        );
      } else {
        assert.equal(fallback, "puntos_interes_flag_off", `${c.id} execute→disabled`);
      }
    }
    if (piCorpusOn && c.expectGuide === "puntos_de_interes" && !c.expectExecuteOrDisabled) {
      assert.notEqual(fallback, "puntos_interes_flag_off", `${c.id} not disabled`);
      assert.ok(
        (used?.articleIds ?? []).some((id) => String(id).startsWith("pi-")) ||
          /Utilidades|Puntos de interés|geocerca|grupo/i.test(replyPreview),
        `${c.id} grounded pi content`,
      );
      assert.doesNotMatch(
        replyPreview,
        /etapas \/ checkpoints del servicio \(no módulo/i,
        `${c.id} no old false TP copy`,
      );
    }
  } catch (e) {
    failed += 1;
    console.error(`FAIL ${c.id}:`, e instanceof Error ? e.message : e);
  }
}

if (failed) {
  console.error(`live-puntos-interes-kb: ${failed} failed`);
  process.exit(1);
}
console.log("OK live-puntos-interes-kb");
