#!/usr/bin/env node
/**
 * LIVE PARCIAL — Hojas de ruta KB (helpers + resolveTurnExecutor).
 *
 * NO ejecuta runTurnExecutorPhase / WhatsApp real.
 *
 * Uso (flag HR off — contrato safe-off previo a activación):
 *   WARA_HOJAS_RUTA_KB_ENABLED=false WARA_PLATFORM_KB_LLM_INTERPRET=true \
 *   npx tsx scripts/live-hojas-ruta-kb.mjs
 *
 * Corpus on (opcional): WARA_HOJAS_RUTA_KB_ENABLED=true …
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
const hrCorpusOn = ["true", "1", "yes"].includes(
  String(process.env.WARA_HOJAS_RUTA_KB_ENABLED ?? "")
    .trim()
    .toLowerCase(),
);
process.env.WARA_HOJAS_RUTA_KB_ENABLED = hrCorpusOn ? "true" : "false";

const HR_THREAD =
  "Cliente: ¿Cómo creo una hoja de ruta?\n" +
  "Atilio: En Utilidades → Hojas de ruta podés dar de alta una hoja con fechas, unidad y chofer.";

const cases = [
  {
    id: "create-hr",
    text: "¿Cómo creo una hoja de ruta?",
    thread: "",
    expectResolve: "info_guides",
    expectGuide: "hojas_de_ruta",
    expectDisabled: !hrCorpusOn,
  },
  {
    id: "follow-hr",
    text: "¿Y después dónde la veo?",
    thread: HR_THREAD,
    lastGuideKind: "hojas_de_ruta",
    expectResolve: "info_guides",
    expectGuide: "hojas_de_ruta",
    expectDisabled: !hrCorpusOn,
  },
  {
    id: "help-hr",
    text: "Necesito ayuda con las hojas de ruta",
    thread: "",
    expectResolve: "info_guides",
    expectGuide: "hojas_de_ruta",
    expectDisabled: !hrCorpusOn,
  },
  {
    id: "editor-hr",
    text: "Editor calendario de rutas",
    thread: "",
    expectResolve: "info_guides",
    expectGuide: "hojas_de_ruta",
    expectDisabled: !hrCorpusOn,
  },
  {
    id: "hoja-turno-tp",
    text: "cómo creo una hoja de turno",
    thread: "",
    expectResolve: "info_guides",
    expectGuide: "transporte_publico",
  },
  {
    id: "mt-preventivo",
    text: "¿Cómo creo un mantenimiento preventivo?",
    thread: "",
    expectResolve: "info_guides",
    expectGuide: "mantenimiento",
  },
  {
    id: "mt-contam-hr",
    text: "¿Cómo creo una hoja de ruta?",
    thread:
      "Cliente: mantenimiento preventivo\nAtilio: En Utilidades → Mantenimiento podés ver planes.",
    expectResolve: "info_guides",
    expectGuide: "hojas_de_ruta",
    expectDisabled: !hrCorpusOn,
  },
  {
    id: "ambiguous-carga",
    text: "Quiero registrar una carga",
    thread: "",
    expectResolve: "info_guides",
    expectAmbiguousOrClarify: true,
  },
  {
    id: "execute-hr",
    text: "Creame una hoja de ruta en mi cuenta",
    thread: "",
    expectResolve: "info_guides",
    expectGuide: "hojas_de_ruta",
    expectExecuteOrDisabled: true,
  },
  {
    id: "ae-inicio",
    text: "¿Qué significa AE INICIO?",
    thread: "",
    expectResolve: "info_guides",
    expectGuide: "hojas_de_ruta",
    expectPendingOrDisabled: true,
  },
  {
    id: "odo",
    text: "Quiero corregir el odómetro",
    thread: "",
    expectResolve: "odometro",
  },
  {
    id: "cert",
    text: "Necesito un certificado",
    thread: "",
    expectResolve: "certificados",
  },
];

let failed = 0;

console.log(
  JSON.stringify({
    mode: hrCorpusOn ? "corpus_on" : "flag_off_safe",
    interpret: true,
  }),
);

for (const c of cases) {
  await new Promise((r) => setTimeout(r, 700));
  const lastGuideKind = c.lastGuideKind ?? null;
  const resolved = await resolveTurnExecutor(c.text, c.thread || c.text, null, {
    lastGuideKind,
  });
  let guideKind = null;
  let used = null;
  let fallback = null;
  let replyPreview = "";
  if (resolved.executor === "info_guides") {
    const interpret = await interpretPlatformKnowledgeTurn({
      selectionText: c.text,
      threadText: c.thread,
      lastGuideKind,
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
    if (c.expectDisabled) {
      assert.equal(fallback, "hojas_ruta_flag_off", `${c.id} disabled fallback`);
      assert.equal(used?.articleIds?.length ?? 0, 0, `${c.id} no hr bodies`);
      assert.match(replyPreview, /no tengo habilitada|aún no|todavía no/i);
      assert.doesNotMatch(replyPreview, /órdenes de trabajo|planes preventivos/i);
    }
    if (c.expectExecuteOrDisabled) {
      if (hrCorpusOn) {
        assert.equal(used?.executionRequest, true, `${c.id} execute`);
        assert.match(replyPreview, /no (puedo|tengo)|por este chat|asesor|paso a paso/i);
      } else {
        assert.equal(fallback, "hojas_ruta_flag_off", `${c.id} execute→disabled`);
      }
    }
    if (c.expectAmbiguousOrClarify) {
      assert.equal(guideKind, null, `${c.id} guideKind null`);
      assert.ok(
        used?.need === "ambiguous" ||
          Boolean(used?.clarifyQuestion) ||
          /\?|viaje|ticket|cisterna|combustible|mercader/i.test(replyPreview),
        `${c.id} ambiguous/clarify`,
      );
      assert.doesNotMatch(replyPreview, /no tengo habilitada la guía/i);
    }
    if (c.expectPendingOrDisabled) {
      if (hrCorpusOn) {
        assert.ok(
          used?.articleIds?.includes("hr-cargas-descargas"),
          `${c.id} article hr-cargas-descargas`,
        );
        assert.match(
          replyPreview,
          /pendiente|no (est[aá]|puedo|tenemos) (confirm|valid)|no confirm|sin validar|manual no|no (tiene|hay) (un )?significado|no (est[aá]|queda) definid|no figura|no afirm|no (puedo|podemos) afirmar|a[uú]n no|no se menciona|§10|consult(a|e|á).*admin/i,
        );
      } else {
        assert.equal(fallback, "hojas_ruta_flag_off", `${c.id} ae→disabled`);
      }
    }
  } catch (e) {
    failed++;
    console.error(`FAIL ${c.id}:`, e.message);
  }
}

if (failed > 0) {
  console.error(`\n✗ live-hojas-ruta-kb PARCIAL con ${failed} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ live-hojas-ruta-kb PARCIAL OK");
