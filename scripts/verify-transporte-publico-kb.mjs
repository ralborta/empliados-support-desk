#!/usr/bin/env node
/**
 * Offline: catálogo Transporte Público + fallbacks KB (sin OpenAI).
 * Uso: npx tsx scripts/verify-transporte-publico-kb.mjs
 */
import assert from "node:assert/strict";
import {
  TRANSPORTE_PUBLICO_ARTICLES,
  listTransporteArticleCatalog,
  buildTransporteKnowledgeContext,
  getTransporteArticlesByIds,
  looksLikeTransportePublicoHowToRequest,
  looksLikeTransportePublicoGuideFollowupQuestion,
  resolveTransporteHowToArticleIds,
} from "../src/lib/transportePublicoKnowledge.ts";
import { buildGroundedInfoGuideReply } from "../src/lib/infoGuideReplies.ts";
import { OPCIONES_KNOWLEDGE_BASE, UNIDADES_KNOWLEDGE_BASE } from "../src/lib/knowledgeBase.ts";

const cats = new Set(TRANSPORTE_PUBLICO_ARTICLES.map((a) => a.category));
for (const c of [
  "conceptos",
  "poi_servicios_trazas",
  "paradas",
  "turnos_hojas_excepciones",
  "monitoreo_informes",
  "errores",
]) {
  assert.ok(cats.has(c), `categoría ${c}`);
}

const catalog = listTransporteArticleCatalog();
assert.ok(catalog.every((a) => a.status !== "future"), "catálogo sin future");
assert.ok(
  TRANSPORTE_PUBLICO_ARTICLES.some((a) => a.id === "tp-traza-editor-futuro" && a.status === "future"),
  "editor futuro marcado",
);

const ctx = buildTransporteKnowledgeContext(["tp-hoja-turno-crear", "tp-excepciones"]);
assert.match(ctx, /Hoja de Turno/i);
assert.match(ctx, /Excepciones/i);
assert.doesNotMatch(ctx, /Editor de Servicios WARA en desarrollo como ya usable/i);

assert.equal(looksLikeTransportePublicoHowToRequest("Cómo cargo un servicio nuevo"), true);
assert.equal(looksLikeTransportePublicoHowToRequest("Quiero ver como crear un turno"), false);
assert.equal(
  looksLikeTransportePublicoHowToRequest("Se sigue repitiendo el mismo inconveniente"),
  false,
);
assert.equal(looksLikeTransportePublicoHowToRequest("Cómo creo un turno de mantenimiento"), false);
assert.equal(looksLikeTransportePublicoHowToRequest("Cómo saco un certificado"), false);
assert.deepEqual(resolveTransporteHowToArticleIds("Cómo cargo un servicio nuevo"), [
  "tp-servicio-crear",
  "tp-conceptos-pilares",
]);
assert.equal(
  looksLikeTransportePublicoGuideFollowupQuestion(
    "Eso",
    "Kira: Sí. ¿Necesitás ayuda con servicios y recorridos, paradas, turnos…?",
    "transporte_publico",
  ),
  true,
);
assert.equal(
  looksLikeTransportePublicoGuideFollowupQuestion(
    "Quiero ver como crear un turno",
    "Kira: Sí. ¿Necesitás ayuda con servicios…?",
    "transporte_publico",
  ),
  true,
);
assert.equal(
  looksLikeTransportePublicoGuideFollowupQuestion(
    "Cómo saco un certificado",
    "Kira: Sí. ¿Necesitás ayuda con servicios…?",
    "transporte_publico",
  ),
  false,
);
assert.equal(
  looksLikeTransportePublicoGuideFollowupQuestion(
    "Dónde está la unidad AG 562 SP",
    "Kira: Sí. ¿Necesitás ayuda con servicios…?",
    "transporte_publico",
  ),
  false,
);
assert.equal(
  looksLikeTransportePublicoGuideFollowupQuestion(
    "Cómo ingreso a la plataforma",
    "Kira: Sí. ¿Necesitás ayuda con servicios…?",
    "transporte_publico",
  ),
  false,
);
assert.equal(
  looksLikeTransportePublicoGuideFollowupQuestion(
    "Se sigue repitiendo el mismo inconveniente",
    "Kira: Sí. ¿Necesitás ayuda con servicios…?",
    "transporte_publico",
  ),
  false,
);

const excludedHints = [
  /contraseña/i,
  /iniciar sesi[oó]n/i,
  /panel de administraci[oó]n \(backoffice\)/i,
];
for (const a of getTransporteArticlesByIds(catalog.map((c) => c.id))) {
  if (a.id === "tp-ejecucion-no-disponible") continue;
  for (const re of excludedHints) {
    assert.doesNotMatch(a.body, re, `${a.id} no debe enseñar acceso/backoffice`);
  }
}

const originalKey = process.env.OPENAI_API_KEY;
delete process.env.OPENAI_API_KEY;
process.env.WARA_PLATFORM_KB_LLM_INTERPRET = "false";
try {
  const tp = await buildGroundedInfoGuideReply(
    "como creo una hoja de turno?",
    "transporte_publico",
  );
  assert.ok(tp.length > 20, "fallback transporte sin API key");
  assert.match(tp, /Transporte Público|hoja|turno|concepto|procedimiento|error/i);

  const opciones = await buildGroundedInfoGuideReply("que es un perfil?", "opciones");
  assert.ok(opciones.length > 20, "regresión opciones sin API key");
  const unidades = await buildGroundedInfoGuideReply("que hace el historial?", "unidades");
  assert.ok(unidades.length > 20, "regresión unidades sin API key");
} finally {
  if (originalKey) process.env.OPENAI_API_KEY = originalKey;
  delete process.env.WARA_PLATFORM_KB_LLM_INTERPRET;
}

assert.ok(OPCIONES_KNOWLEDGE_BASE.length > 2000);
assert.ok(UNIDADES_KNOWLEDGE_BASE.length > 2000);

console.log("OK verify-transporte-publico-kb");
