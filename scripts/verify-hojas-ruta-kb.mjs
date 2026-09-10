#!/usr/bin/env node
/**
 * Offline: contrato flag HR (reconocer ≠ entregar) + fronteras TP/MT + continuidad.
 * Uso: npx tsx scripts/verify-hojas-ruta-kb.mjs
 */
import assert from "node:assert/strict";
import {
  HOJAS_RUTA_ARTICLES,
  isHojasRutaKbEnabled,
  listHojasRutaArticleCatalog,
  buildHojasRutaKnowledgeContext,
  getHojasRutaArticlesByIds,
  buildHojasRutaDisabledChannelReply,
} from "../src/lib/hojasRutaKnowledge.ts";
import {
  detectInfoGuideKind,
  buildGroundedInfoGuideReplyWithMeta,
  buildInfoGuideReply,
} from "../src/lib/infoGuideReplies.ts";
import {
  applyPlatformGuideInterpretGuards,
  shouldRouteInterpretToInfoGuides,
} from "../src/lib/infoGuideInterpretAI.ts";
import { resolveTurnExecutor } from "../src/lib/whatsappTurnClassifierAI.ts";
import { classifyTurnExecutor } from "../src/lib/whatsappTurnRouter.ts";
import { buildAtilioAgentTools } from "../src/lib/atilioAgentTools.ts";
import { agentCorePromptMentionsHojasRuta } from "../src/lib/atilioAgent.ts";

const prevHr = process.env.WARA_HOJAS_RUTA_KB_ENABLED;
const prevCb = process.env.WARA_COMBUSTIBLE_KB_ENABLED;
const prevKb = process.env.WARA_PLATFORM_KB_LLM_INTERPRET;
const prevKey = process.env.OPENAI_API_KEY;

function restoreEnv() {
  if (prevHr === undefined) delete process.env.WARA_HOJAS_RUTA_KB_ENABLED;
  else process.env.WARA_HOJAS_RUTA_KB_ENABLED = prevHr;
  if (prevCb === undefined) delete process.env.WARA_COMBUSTIBLE_KB_ENABLED;
  else process.env.WARA_COMBUSTIBLE_KB_ENABLED = prevCb;
  if (prevKb === undefined) delete process.env.WARA_PLATFORM_KB_LLM_INTERPRET;
  else process.env.WARA_PLATFORM_KB_LLM_INTERPRET = prevKb;
  if (prevKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = prevKey;
}

const HR_THREAD =
  "Cliente: ¿Cómo creo una hoja de ruta?\nAtilio: En Utilidades → Hojas de ruta podés dar de alta una hoja.";

try {
  // --- Flag OFF: reconocer hojas_de_ruta, no entregar hr-*, no caer a MT/Unidades ---
  delete process.env.WARA_HOJAS_RUTA_KB_ENABLED;
  assert.equal(isHojasRutaKbEnabled(), false);
  assert.ok(listHojasRutaArticleCatalog().length >= 10, "catálogo reconocimiento siempre");
  assert.equal(getHojasRutaArticlesByIds(["hr-concepto-mapa"]).length, 0);
  assert.match(buildHojasRutaKnowledgeContext(["hr-concepto-mapa"]), /deshabilitada/i);
  assert.equal(detectInfoGuideKind("hojas de ruta"), "hojas_de_ruta");
  assert.equal(detectInfoGuideKind("modulo de hojas de ruta"), "hojas_de_ruta");

  delete process.env.OPENAI_API_KEY;
  process.env.WARA_PLATFORM_KB_LLM_INTERPRET = "false";

  const forcedOff = await buildGroundedInfoGuideReplyWithMeta(
    "como creo una hoja de ruta?",
    "hojas_de_ruta",
  );
  assert.equal(forcedOff.guideKind, "hojas_de_ruta");
  assert.equal(forcedOff.fallback, "hojas_ruta_flag_off");
  assert.match(forcedOff.message, /no tengo habilitada la guía de \*Hojas de ruta\*/i);
  assert.match(forcedOff.message, /hoja de turno/i);
  assert.doesNotMatch(forcedOff.message, /Mantenimiento se enfoca|órdenes de trabajo|planes preventivos/i);
  assert.doesNotMatch(forcedOff.message, /Agregar hoja de ruta|predefinidas — plantillas/i);
  assert.match(forcedOff.interpret?.reason ?? "", /hojas_ruta_module_disabled/);

  // Historial contaminado por Mantenimiento + consulta HR → disabled HR, no MT.
  const mtContaminated = await buildGroundedInfoGuideReplyWithMeta(
    "¿Cómo creo una hoja de ruta?",
    "mantenimiento",
    null,
    "Cliente: mantenimiento preventivo\nAtilio: En Utilidades → Mantenimiento…",
  );
  assert.equal(mtContaminated.guideKind, "hojas_de_ruta");
  assert.equal(mtContaminated.fallback, "hojas_ruta_flag_off");
  assert.doesNotMatch(mtContaminated.message, /órdenes de trabajo|planes preventivos/i);

  const knowledgeAsk = await buildGroundedInfoGuideReplyWithMeta(
    "y sobre hoja de ruta tenes conocimientos?",
    "mantenimiento",
  );
  assert.equal(knowledgeAsk.guideKind, "hojas_de_ruta");
  assert.equal(knowledgeAsk.fallback, "hojas_ruta_flag_off");
  assert.doesNotMatch(knowledgeAsk.message, /módulo de Mantenimiento|órdenes de trabajo/i);

  // Continuidad con flag off: requiere lastGuideKind estructurado (no prosa del hilo).
  const followOff = applyPlatformGuideInterpretGuards(
    {
      route: "continue_normal",
      guideKind: null,
      need: "ambiguous",
      articleIds: [],
      clarifyQuestion: null,
      executionRequest: false,
      confidence: 0.4,
      reason: "test",
    },
    "¿Y después dónde la veo?",
    HR_THREAD,
    { lastGuideKind: "hojas_de_ruta" },
  );
  assert.equal(followOff.guideKind, "hojas_de_ruta");
  assert.equal(followOff.route, "info_guides");
  assert.equal(followOff.articleIds.length, 0);
  assert.match(followOff.reason ?? "", /hojas_ruta_module_disabled/);
  assert.ok(shouldRouteInterpretToInfoGuides(followOff));

  const mtSteal = applyPlatformGuideInterpretGuards(
    {
      route: "info_guides",
      guideKind: "mantenimiento",
      need: "definition",
      articleIds: ["mt-concepto-y-mapa"],
      clarifyQuestion: null,
      executionRequest: false,
      confidence: 0.9,
      reason: "test_mt_steal",
    },
    "¿Cómo creo una hoja de ruta?",
    "",
  );
  assert.equal(mtSteal.guideKind, "hojas_de_ruta");
  assert.match(mtSteal.reason ?? "", /hojas_ruta_module_disabled/);
  assert.equal(mtSteal.articleIds.length, 0);
  assert.ok(mtSteal.clarifyQuestion);

  // Frontera TP con flag off: hoja de turno ≠ HR disabled.
  const turnoOff = applyPlatformGuideInterpretGuards(
    {
      route: "info_guides",
      guideKind: "hojas_de_ruta",
      need: "procedure",
      articleIds: [],
      clarifyQuestion: null,
      executionRequest: false,
      confidence: 0.8,
      reason: "test",
    },
    "cómo creo una hoja de turno",
    "",
  );
  assert.equal(turnoOff.guideKind, "transporte_publico");
  assert.ok(turnoOff.articleIds.includes("tp-hoja-turno-crear"));

  const preventivoOff = applyPlatformGuideInterpretGuards(
    {
      route: "continue_normal",
      guideKind: null,
      need: "procedure",
      articleIds: [],
      clarifyQuestion: null,
      executionRequest: false,
      confidence: 0.5,
      reason: "test",
    },
    "¿Cómo creo un mantenimiento preventivo?",
    "",
  );
  // Sin LLM, la guarda MT por dominio puede no disparar; al menos no debe ser HR disabled.
  assert.notEqual(preventivoOff.guideKind, "hojas_de_ruta");

  const staticOff = buildInfoGuideReply("x", "hojas_de_ruta");
  assert.equal(staticOff, buildHojasRutaDisabledChannelReply());

  const toolsOff = buildAtilioAgentTools(false);
  const guiaOff = toolsOff.find((t) => t.function.name === "guia_informativa");
  assert.ok(guiaOff);
  assert.match(guiaOff.function.description, /hojas de ruta/i);

  // --- E2E resolveTurnExecutor (clasificador productivo) con flag HR off ---
  process.env.WARA_TURN_AI_CLASSIFY = "false";
  const mtThread =
    "Cliente: mantenimiento preventivo\nAtilio: En Utilidades → Mantenimiento podés ver planes.";

  async function assertResolve(label, text, thread, expectExecutor, lastGuideKind = null) {
    const r = await resolveTurnExecutor(text, thread, null, { lastGuideKind });
    assert.equal(r.executor, expectExecutor, `${label}: got ${r.executor}`);
  }

  // A) Intérprete LLM off + sin API key → guardas offline; nunca Unidades/MT ante HR.
  delete process.env.OPENAI_API_KEY;
  process.env.WARA_PLATFORM_KB_LLM_INTERPRET = "false";
  await assertResolve("off/create", "¿Cómo creo una hoja de ruta?", "", "info_guides");
  await assertResolve(
    "off/follow",
    "¿Y después dónde la veo?",
    HR_THREAD,
    "info_guides",
    "hojas_de_ruta",
  );
  await assertResolve(
    "off/help",
    "Necesito ayuda con las hojas de ruta",
    "",
    "info_guides",
  );
  await assertResolve(
    "off/editor",
    "Editor calendario de rutas",
    "",
    "info_guides",
  );
  await assertResolve(
    "off/mt-contam",
    "¿Cómo creo una hoja de ruta?",
    mtThread,
    "info_guides",
  );
  await assertResolve(
    "off/turno",
    "¿Cómo creo una hoja de turno?",
    "",
    "info_guides",
  );
  await assertResolve(
    "off/preventivo",
    "¿Cómo creo un mantenimiento preventivo?",
    "",
    "info_guides",
  );
  // Trámites duros intactos
  await assertResolve("off/odo", "Quiero corregir el odómetro", "", "odometro");
  await assertResolve("off/cert", "Necesito un certificado de cobertura", "", "certificados");

  // B) Intérprete “on” pero sin API key (= fallo de proveedor / config) → mismo contrato.
  process.env.WARA_PLATFORM_KB_LLM_INTERPRET = "true";
  delete process.env.OPENAI_API_KEY;
  await assertResolve("nokey/create", "¿Cómo creo una hoja de ruta?", "", "info_guides");
  await assertResolve(
    "nokey/follow",
    "¿Y después dónde la veo?",
    HR_THREAD,
    "info_guides",
    "hojas_de_ruta",
  );
  await assertResolve(
    "nokey/editor",
    "Editor calendario de rutas",
    "",
    "info_guides",
  );

  // --- Corpus (flag on) ---
  process.env.WARA_HOJAS_RUTA_KB_ENABLED = "true";
  assert.equal(isHojasRutaKbEnabled(), true);
  const cats = new Set(HOJAS_RUTA_ARTICLES.map((a) => a.category));
  for (const c of [
    "concepto",
    "listado",
    "alta",
    "puntos",
    "recorrido",
    "predefinidas",
    "masivo",
    "calendario",
    "cargas",
    "validaciones",
    "fronteras",
  ]) {
    assert.ok(cats.has(c), `categoría ${c}`);
  }
  const catalog = listHojasRutaArticleCatalog();
  assert.ok(catalog.length >= 10, "catálogo con artículos");
  assert.ok(catalog.every((a) => a.status !== "future"), "catálogo sin future");
  assert.ok(catalog.every((a) => a.id.startsWith("hr-")), "ids hr-*");
  assert.ok(catalog.some((a) => a.id === "hr-ejecucion-no-disponible"));

  const ctx = buildHojasRutaKnowledgeContext(["hr-concepto-mapa", "hr-fronteras"]);
  assert.match(ctx, /Utilidades → Hojas de ruta|Hojas de ruta/i);
  assert.match(ctx, /hoja de turno|NO es|≠/i);

  const cargas = getHojasRutaArticlesByIds(["hr-cargas-descargas"])[0];
  assert.match(cargas.body, /AE INICIO/);
  assert.ok(cargas.restrictions?.some((r) => /AE INICIO|§10/.test(r)));

  const puntos = getHojasRutaArticlesByIds(["hr-puntos-detalle"])[0];
  assert.ok(
    puntos.restrictions?.some((r) => /hoja real|pendiente/i.test(r)),
    "carga condicional en hoja real = pendiente",
  );
  assert.doesNotMatch(
    puntos.body,
    /En la hoja real el relevamiento lo describe en el flujo de puntos con la misma lógica condicional/,
  );

  const baseWrong = {
    route: "info_guides",
    guideKind: "hojas_de_ruta",
    need: "procedure",
    articleIds: ["hr-alta-asignacion"],
    clarifyQuestion: null,
    executionRequest: false,
    confidence: 0.8,
    reason: "test",
  };
  const turnoFixed = applyPlatformGuideInterpretGuards(
    baseWrong,
    "cómo creo una hoja de turno",
    "",
  );
  assert.equal(turnoFixed.guideKind, "transporte_publico");
  assert.ok(turnoFixed.articleIds.includes("tp-hoja-turno-crear"));

  const aeFixed = applyPlatformGuideInterpretGuards(
    {
      ...baseWrong,
      guideKind: "mantenimiento",
      articleIds: ["mt-contar-realizacion"],
      need: "definition",
    },
    "¿Qué significa AE INICIO?",
    "",
  );
  assert.equal(aeFixed.guideKind, "hojas_de_ruta");
  assert.ok(aeFixed.articleIds.includes("hr-cargas-descargas"));

  const followFixed = applyPlatformGuideInterpretGuards(
    {
      route: "continue_normal",
      guideKind: null,
      need: "ambiguous",
      articleIds: [],
      clarifyQuestion: null,
      executionRequest: false,
      confidence: 0.4,
      reason: "test",
    },
    "¿Y después dónde la veo?",
    HR_THREAD,
    { lastGuideKind: "hojas_de_ruta" },
  );
  assert.equal(followFixed.guideKind, "hojas_de_ruta");
  assert.equal(followFixed.route, "info_guides");
  assert.ok(followFixed.articleIds.some((id) => id.startsWith("hr-")));

  // Sin lastGuideKind: mención de “hoja de ruta” en el hilo NO fuerza continuidad.
  const followNoStructured = applyPlatformGuideInterpretGuards(
    {
      route: "continue_normal",
      guideKind: null,
      need: "ambiguous",
      articleIds: [],
      clarifyQuestion: null,
      executionRequest: false,
      confidence: 0.4,
      reason: "test",
    },
    "¿Y después dónde la veo?",
    HR_THREAD,
  );
  assert.notEqual(followNoStructured.guideKind, "hojas_de_ruta");
  assert.doesNotMatch(followNoStructured.reason ?? "", /hr_continuity_guard/);

  const createOn = applyPlatformGuideInterpretGuards(
    {
      route: "continue_normal",
      guideKind: null,
      need: "procedure",
      articleIds: [],
      clarifyQuestion: null,
      executionRequest: false,
      confidence: 0.5,
      reason: "test",
    },
    "¿Cómo creo una hoja de ruta?",
    "",
  );
  assert.equal(createOn.guideKind, "hojas_de_ruta");
  assert.ok(createOn.articleIds.includes("hr-alta-asignacion"));

  const cargaAmb = applyPlatformGuideInterpretGuards(
    {
      route: "info_guides",
      guideKind: "hojas_de_ruta",
      need: "procedure",
      articleIds: ["hr-cargas-descargas"],
      clarifyQuestion: null,
      executionRequest: false,
      confidence: 0.9,
      reason: "test_carga_misroute",
    },
    "Quiero registrar una carga",
    "",
  );
  assert.equal(cargaAmb.guideKind, null);
  assert.equal(cargaAmb.need, "ambiguous");
  assert.match(cargaAmb.clarifyQuestion ?? "", /mercader|ticket|cisterna/i);
  assert.ok(shouldRouteInterpretToInfoGuides(cargaAmb));
  process.env.WARA_TURN_AI_CLASSIFY = "false";
  const cargaResolve = await resolveTurnExecutor("Quiero registrar una carga", "");
  assert.equal(cargaResolve.executor, "info_guides");

  // “Cargar servicios de transporte” ≠ ambigüedad de “una carga”: preservar TP.
  const cargaTpServicio = applyPlatformGuideInterpretGuards(
    {
      route: "info_guides",
      guideKind: "transporte_publico",
      need: "procedure",
      articleIds: ["tp-servicio-crear"],
      clarifyQuestion: null,
      executionRequest: false,
      confidence: 0.92,
      reason: "test_tp_servicio",
    },
    "Quiero cargar unos servicios a transporte público pero no entiendo cómo hacerlo",
    "",
  );
  assert.equal(cargaTpServicio.guideKind, "transporte_publico");
  assert.ok(cargaTpServicio.articleIds.includes("tp-servicio-crear"));
  assert.doesNotMatch(cargaTpServicio.reason ?? "", /ambiguous_carga_guard/);
  assert.equal(cargaTpServicio.need, "procedure");

  const cargaServicioPasajeros = applyPlatformGuideInterpretGuards(
    {
      route: "info_guides",
      guideKind: "transporte_publico",
      need: "procedure",
      articleIds: ["tp-servicio-crear"],
      clarifyQuestion: null,
      executionRequest: false,
      confidence: 0.9,
      reason: "test_tp_pasajeros",
    },
    "Cómo cargo un servicio a transporte de pasajeros?",
    "",
  );
  assert.equal(cargaServicioPasajeros.guideKind, "transporte_publico");
  assert.ok(cargaServicioPasajeros.articleIds.includes("tp-servicio-crear"));
  assert.doesNotMatch(cargaServicioPasajeros.reason ?? "", /ambiguous_carga_guard|hr_continuity_guard/);

  // Aclaración del bot (cualquier redacción) no contamina: sin lastGuideKind=HR no hay continuidad.
  const CARGA_CLARIFY_THREAD = [
    "Cliente: Quiero cargar unos servicios a transporte público",
    "Atilio: ¿La carga es mercadería en una hoja de ruta, un ticket de combustible de una unidad, o carga a una cisterna?",
  ].join("\n");
  const afterCargaClarify = applyPlatformGuideInterpretGuards(
    {
      route: "info_guides",
      guideKind: "transporte_publico",
      need: "procedure",
      articleIds: ["tp-servicio-crear"],
      clarifyQuestion: null,
      executionRequest: false,
      confidence: 0.93,
      reason: "test_after_clarify",
    },
    "Ninguna de esas 3. Es un servicio de transporte público. Cómo lo cargo?",
    CARGA_CLARIFY_THREAD,
  );
  assert.equal(afterCargaClarify.guideKind, "transporte_publico");
  assert.ok(afterCargaClarify.articleIds.includes("tp-servicio-crear"));
  assert.doesNotMatch(afterCargaClarify.reason ?? "", /hr_continuity_guard|ambiguous_carga_guard/);

  // Reformulación distinta del bot (no depende de scrub de frase fija).
  const REFORMULATED_CLARIFY_THREAD = [
    "Cliente: Quiero cargar unos servicios a transporte público",
    "Atilio: ¿Hablás de una carga de mercadería en hoja de ruta, de combustible en la unidad, o de llenar una cisterna?",
  ].join("\n");
  const afterReformulated = applyPlatformGuideInterpretGuards(
    {
      route: "info_guides",
      guideKind: "transporte_publico",
      need: "procedure",
      articleIds: ["tp-servicio-crear"],
      clarifyQuestion: null,
      executionRequest: false,
      confidence: 0.93,
      reason: "test_reformulated_clarify",
    },
    "Ninguna. Es un servicio de transporte público. Cómo lo cargo?",
    REFORMULATED_CLARIFY_THREAD,
  );
  assert.equal(afterReformulated.guideKind, "transporte_publico");
  assert.ok(afterReformulated.articleIds.includes("tp-servicio-crear"));
  assert.doesNotMatch(afterReformulated.reason ?? "", /hr_continuity_guard/);

  const afterReformulatedNoSeed = applyPlatformGuideInterpretGuards(
    {
      route: "continue_normal",
      guideKind: null,
      need: "ambiguous",
      articleIds: [],
      clarifyQuestion: null,
      executionRequest: false,
      confidence: 0.4,
      reason: "test",
    },
    "Ninguna. Es un servicio de transporte público. Cómo lo cargo?",
    REFORMULATED_CLARIFY_THREAD,
  );
  assert.notEqual(afterReformulatedNoSeed.guideKind, "hojas_de_ruta");
  assert.doesNotMatch(afterReformulatedNoSeed.reason ?? "", /hr_continuity_guard/);

  // Sin decisión TP previa: el hilo de clarify tampoco debe forzar HR.
  const afterClarifyNoSeed = applyPlatformGuideInterpretGuards(
    {
      route: "continue_normal",
      guideKind: null,
      need: "ambiguous",
      articleIds: [],
      clarifyQuestion: null,
      executionRequest: false,
      confidence: 0.4,
      reason: "test",
    },
    "Ninguna de esas 3. Es un servicio de transporte público. Cómo lo cargo?",
    CARGA_CLARIFY_THREAD,
  );
  assert.notEqual(afterClarifyNoSeed.guideKind, "hojas_de_ruta");
  assert.doesNotMatch(afterClarifyNoSeed.reason ?? "", /hr_continuity_guard/);

  const toolsOn = buildAtilioAgentTools(false);
  const guiaOn = toolsOn.find((t) => t.function.name === "guia_informativa");
  assert.match(guiaOn.function.description, /hojas de ruta/i);

  delete process.env.OPENAI_API_KEY;
  process.env.WARA_PLATFORM_KB_LLM_INTERPRET = "false";
  const onMeta = await buildGroundedInfoGuideReplyWithMeta(
    "como creo una hoja de ruta?",
    "hojas_de_ruta",
  );
  assert.equal(onMeta.guideKind, "hojas_de_ruta");
  assert.notEqual(onMeta.fallback, "hojas_ruta_flag_off");
  assert.doesNotMatch(onMeta.message, /no tengo habilitada la guía/i);

  // Regresión reglas: odo/cert no se roban (sin LLM).
  assert.equal(
    classifyTurnExecutor("necesito el certificado de cobertura", ""),
    "certificados",
  );
  assert.equal(
    classifyTurnExecutor("quiero cambiar el odómetro de la AB123CD", ""),
    "odometro",
  );

  assert.equal(agentCorePromptMentionsHojasRuta(), false);

  console.log("OK verify-hojas-ruta-kb");
} finally {
  restoreEnv();
}
