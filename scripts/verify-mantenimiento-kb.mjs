#!/usr/bin/env node
/**
 * Offline: catálogo Mantenimiento mt-* + fallbacks + jerga/continuidad + regresión odo/cert/TP.
 * Uso: npx tsx scripts/verify-mantenimiento-kb.mjs
 */
import assert from "node:assert/strict";
import {
  MANTENIMIENTO_ARTICLES,
  listMantenimientoArticleCatalog,
  buildMantenimientoKnowledgeContext,
  getMantenimientoArticlesByIds,
} from "../src/lib/mantenimientoKnowledge.ts";
import {
  detectInfoGuideKind,
  buildGroundedInfoGuideReply,
  buildInfoGuideReply,
} from "../src/lib/infoGuideReplies.ts";
import { shouldRouteInterpretToInfoGuides } from "../src/lib/infoGuideInterpretAI.ts";
import { resolveTurnExecutor } from "../src/lib/whatsappTurnClassifierAI.ts";
import { classifyTurnExecutor } from "../src/lib/whatsappTurnRouter.ts";
import { MANTENIMIENTO_KNOWLEDGE_BASE } from "../src/lib/knowledgeBase.ts";
import {
  looksLikeMaintenanceDomainTermQuestion,
  looksLikeMaintenanceGuideFollowupQuestion,
  looksLikeMaintenanceGuideContextInThread,
} from "../src/lib/waraApi.ts";

const prevKb = process.env.WARA_PLATFORM_KB_LLM_INTERPRET;
const prevKey = process.env.OPENAI_API_KEY;

function restoreEnv() {
  if (prevKb === undefined) delete process.env.WARA_PLATFORM_KB_LLM_INTERPRET;
  else process.env.WARA_PLATFORM_KB_LLM_INTERPRET = prevKb;
  if (prevKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = prevKey;
}

try {
  // --- Corpus ---
  const cats = new Set(MANTENIMIENTO_ARTICLES.map((a) => a.category));
  for (const c of [
    "concepto",
    "preventivo",
    "correctivo",
    "toma_deje",
    "operacion",
    "informes",
    "integraciones",
    "validaciones",
  ]) {
    assert.ok(cats.has(c), `categoría ${c}`);
  }

  const catalog = listMantenimientoArticleCatalog();
  assert.ok(catalog.length >= 12, "catálogo con artículos");
  assert.ok(catalog.every((a) => a.id.startsWith("mt-")), "ids mt-*");
  assert.ok(catalog.every((a) => a.status !== "future"), "catálogo sin future");
  assert.ok(catalog.some((a) => a.id === "mt-ejecucion-no-disponible"));
  assert.ok(catalog.some((a) => a.id === "mt-contar-realizacion"));

  const ctx = buildMantenimientoKnowledgeContext([
    "mt-concepto-y-mapa",
    "mt-asignar-plan-unidad",
  ]);
  assert.match(ctx, /SOLO configuraci[oó]n|SÓLO configuraci[oó]n|solo catálogos/i);
  assert.match(ctx, /MIS ATAJOS.*TAREAS|TAREAS/i);
  assert.doesNotMatch(ctx, /CÓMO AGENDAR UN MANTENIMIENTO/);

  const mapa = getMantenimientoArticlesByIds(["mt-concepto-y-mapa"])[0];
  assert.match(mapa.body, /Utilidades → Mantenimiento/);
  assert.match(mapa.body, /Paneles → Tareas/);

  // No afirmar pendientes §11 como hechos
  const admin = getMantenimientoArticlesByIds(["mt-administrar-costos"])[0];
  assert.match(admin.body, /PENDIENTE|no afirmar/i);
  assert.doesNotMatch(admin.body, /para cerrarla y recalcular el próximo vencimiento/);
  const flujo = getMantenimientoArticlesByIds(["mt-flujo-preventivo"])[0];
  assert.match(flujo.body, /pendiente §11/i);
  assert.doesNotMatch(flujo.body, /la OT avanza hasta FINALIZADA/);
  const contar = getMantenimientoArticlesByIds(["mt-contar-realizacion"])[0];
  assert.match(contar.body, /PENDIENTE DE VALIDACI[OÓ]N/i);
  assert.match(contar.body, /NO inventes|no puede afirmar|no afirm/i);

  // Blob viejo deprecado
  assert.match(MANTENIMIENTO_KNOWLEDGE_BASE, /DEPRECADO|mt-\*/i);
  assert.doesNotMatch(MANTENIMIENTO_KNOWLEDGE_BASE, /CÓMO AGENDAR UN MANTENIMIENTO/);

  // --- Jerga / continuidad (reglas, sin OpenAI) ---
  delete process.env.OPENAI_API_KEY;
  process.env.WARA_PLATFORM_KB_LLM_INTERPRET = "false";

  assert.equal(
    looksLikeMaintenanceDomainTermQuestion("¿Qué significa contar a partir de la realización?"),
    true,
  );
  assert.equal(
    detectInfoGuideKind("¿Qué significa contar a partir de la realización?"),
    "mantenimiento",
  );
  assert.equal(
    classifyTurnExecutor(
      "¿Qué significa contar a partir de la realización?",
      "¿Qué significa contar a partir de la realización?",
    ),
    "info_guides",
  );

  const mtThread =
    "Cliente: ¿Cómo asigno un plan de mantenimiento a una unidad?\n" +
    "Atilio: Para asignar un plan: Unidades → MIS ATAJOS → TAREAS. Elegí el plan y guardá.";
  assert.equal(looksLikeMaintenanceGuideContextInThread(mtThread), true);
  assert.equal(looksLikeMaintenanceGuideFollowupQuestion("¿Y después dónde la sigo?", mtThread), true);
  assert.equal(classifyTurnExecutor("¿Y después dónde la sigo?", mtThread), "info_guides");

  const otThread =
    "Cliente: mantenimiento\nAtilio: Así está armado Mantenimiento en Wara:\n" +
    "Configuración: Utilidades → Mantenimiento.\nOperación: Paneles → Órdenes de trabajo.";
  assert.equal(
    classifyTurnExecutor(
      "¿Qué acción hace que una orden pase de iniciada a finalizada?",
      otThread,
    ),
    "info_guides",
  );

  assert.equal(detectInfoGuideKind("mantenimiento"), "mantenimiento");
  assert.equal(detectInfoGuideKind("como agendo un mantenimiento"), "mantenimiento");

  const generic = buildInfoGuideReply("mantenimiento", "mantenimiento");
  assert.match(generic, /Utilidades → Mantenimiento/);
  assert.match(generic, /Paneles|MIS ATAJOS|TAREAS/i);
  assert.doesNotMatch(generic, /Elegí plan\/tarea preventiva o tarea\/orden correctiva/);

  const preventivo = buildInfoGuideReply("plan preventivo", "mantenimiento");
  assert.match(preventivo, /Plan de mantenimiento|preventivo/i);
  assert.match(preventivo, /asignar|TAREAS|Unidades/i);

  const correctivo = buildInfoGuideReply("tarea correctiva", "mantenimiento");
  assert.match(correctivo, /correctiv|Órdenes de trabajo|Paneles/i);

  const grounded = await buildGroundedInfoGuideReply(
    "como se usa el modulo de mantenimiento?",
    "mantenimiento",
  );
  assert.ok(grounded.length > 40);
  assert.match(grounded, /Utilidades|Paneles|Unidades|TAREAS/i);

  const tp = await buildGroundedInfoGuideReply(
    "como creo una hoja de turno?",
    "transporte_publico",
  );
  assert.ok(tp.length > 20);

  // Regresión trámites duros
  assert.equal(
    classifyTurnExecutor("Quiero corregir el odómetro", "Quiero corregir el odómetro"),
    "odometro",
  );
  assert.equal(
    classifyTurnExecutor(
      "Necesito un certificado de cobertura",
      "Necesito un certificado de cobertura",
    ),
    "certificados",
  );
  assert.equal(
    (await resolveTurnExecutor("Quiero corregir el odómetro", "Quiero corregir el odómetro"))
      .executor,
    "odometro",
  );
  assert.equal(
    (
      await resolveTurnExecutor(
        "Necesito un certificado de cobertura",
        "Necesito un certificado de cobertura",
      )
    ).executor,
    "certificados",
  );

  assert.equal(
    shouldRouteInterpretToInfoGuides({
      route: "info_guides",
      guideKind: "mantenimiento",
      need: "procedure",
      articleIds: ["mt-concepto-y-mapa"],
      clarifyQuestion: null,
      executionRequest: false,
      confidence: 0.99,
      reason: "test",
    }),
    true,
  );

  console.log("OK verify-mantenimiento-kb");
} finally {
  restoreEnv();
}
