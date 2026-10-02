#!/usr/bin/env node
/**
 * Live×3: “cargar servicio TP” no cae a ambiguous_carga ni continuidad HR falsa.
 * Uso: npx tsx scripts/live-carga-tp-servicio.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
for (const name of [".env.local", ".env"]) {
  const p = path.join(root, "..", name);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());
    if (!m) continue;
    const key = m[1];
    let val = m[2];
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]?.trim()) process.env[key] = val;
  }
}

const { interpretPlatformKnowledgeTurn } = await import(
  "../src/lib/infoGuideInterpretAI.ts"
);
const { buildGroundedInfoGuideReplyWithMeta } = await import(
  "../src/lib/infoGuideReplies.ts"
);

if (!process.env.OPENAI_API_KEY?.trim()) {
  console.error("OPENAI_API_KEY requerida");
  process.exit(1);
}
process.env.WARA_PLATFORM_KB_LLM_INTERPRET = "true";
process.env.WARA_HOJAS_RUTA_KB_ENABLED = "true";

const CARGA_CLARIFY_THREAD = [
  "Cliente: Quiero cargar unos servicios a transporte público",
  "Atilio: ¿La carga es mercadería en una hoja de ruta, un ticket de combustible de una unidad, o carga a una cisterna?",
].join("\n");

async function once(n) {
  const cases = [
    {
      id: "cargar-servicios-tp",
      text: "Quiero cargar unos servicios a transporte público pero no entiendo cómo hacerlo",
      thread: "",
    },
    {
      id: "after-clarify",
      text: "Ninguna de esas 3. Es un servicio de transporte público. Cómo lo cargo?",
      thread: CARGA_CLARIFY_THREAD,
    },
    {
      id: "cargo-pasajeros",
      text: "Cómo cargo un servicio a transporte de pasajeros?",
      thread: "",
    },
    {
      id: "registrar-carga",
      text: "Quiero registrar una carga",
      thread: "",
      expectAmbiguous: true,
    },
  ];
  for (const c of cases) {
    const interpret = await interpretPlatformKnowledgeTurn({
      selectionText: c.text,
      threadText: c.thread,
    });
    const grounded = await buildGroundedInfoGuideReplyWithMeta(
      c.text,
      interpret?.guideKind ?? null,
      null,
      c.thread,
      interpret,
    );
    const row = {
      run: n,
      id: c.id,
      guideKind: grounded.guideKind ?? interpret?.guideKind,
      articleIds: grounded.interpret?.articleIds ?? interpret?.articleIds,
      reason: grounded.interpret?.reason ?? interpret?.reason,
      fallback: grounded.fallback,
      preview: grounded.message.slice(0, 180),
    };
    console.log(JSON.stringify(row));
    if (c.expectAmbiguous) {
      assert.equal(interpret?.need, "ambiguous", c.id);
      assert.match(interpret?.clarifyQuestion ?? "", /mercader|ticket|cisterna/i, c.id);
      continue;
    }
    assert.equal(row.guideKind, "transporte_publico", `${c.id} guideKind`);
    assert.ok(
      (row.articleIds ?? []).some((id) => String(id).startsWith("tp-")),
      `${c.id} tp articles`,
    );
    assert.doesNotMatch(row.preview, /manual de Wara no cubre/i, `${c.id} no false miss`);
    assert.doesNotMatch(row.preview, /ayuda con las hojas de ruta/i, `${c.id} no HR offer`);
  }
}

for (let i = 1; i <= 3; i++) {
  await once(i);
}
console.log("OK live-carga-tp-servicio x3");
