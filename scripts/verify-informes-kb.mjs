#!/usr/bin/env node
/**
 * Offline: contrato Informes (reconocer ≠ entregar) + secciones + fronteras.
 * Uso: npx tsx scripts/verify-informes-kb.mjs
 */
import assert from "node:assert/strict";
import {
  INFORMES_ARTICLES,
  isInformesKbEnabled,
  isInformesSectionEnabled,
  parseInformesKbSections,
  listInformesArticleCatalog,
  getInformesArticlesByIds,
  buildInformesKnowledgeContext,
  buildInformesDisabledChannelReply,
  buildInformesSectionDisabledReply,
  categoryFromInformesArticleId,
} from "../src/lib/informesKnowledge.ts";
import {
  detectInfoGuideKind,
  buildGroundedInfoGuideReplyWithMeta,
} from "../src/lib/infoGuideReplies.ts";
import {
  applyPlatformGuideInterpretGuards,
  shouldRouteInterpretToInfoGuides,
  selectInformesCatalogsForInterpret,
} from "../src/lib/infoGuideInterpretAI.ts";
import { resolveTurnExecutor } from "../src/lib/whatsappTurnClassifierAI.ts";
import { parseLastInfoGuideContext } from "../src/lib/lastInfoGuideContext.ts";
import { buildAtilioAgentTools } from "../src/lib/atilioAgentTools.ts";

const prevInf = process.env.WARA_INFORMES_KB_ENABLED;
const prevSec = process.env.WARA_INFORMES_KB_SECTIONS;
const prevKb = process.env.WARA_PLATFORM_KB_LLM_INTERPRET;
const prevKey = process.env.OPENAI_API_KEY;

function restoreEnv() {
  if (prevInf === undefined) delete process.env.WARA_INFORMES_KB_ENABLED;
  else process.env.WARA_INFORMES_KB_ENABLED = prevInf;
  if (prevSec === undefined) delete process.env.WARA_INFORMES_KB_SECTIONS;
  else process.env.WARA_INFORMES_KB_SECTIONS = prevSec;
  if (prevKb === undefined) delete process.env.WARA_PLATFORM_KB_LLM_INTERPRET;
  else process.env.WARA_PLATFORM_KB_LLM_INTERPRET = prevKb;
  if (prevKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = prevKey;
}

const seed = {
  route: "continue_normal",
  guideKind: null,
  need: "ambiguous",
  articleIds: [],
  clarifyQuestion: null,
  executionRequest: false,
  confidence: 0.4,
  reason: "seed",
};

try {
  delete process.env.WARA_INFORMES_KB_ENABLED;
  delete process.env.WARA_INFORMES_KB_SECTIONS;
  delete process.env.OPENAI_API_KEY;
  process.env.WARA_PLATFORM_KB_LLM_INTERPRET = "false";

  assert.equal(isInformesKbEnabled(), false);
  assert.equal(parseInformesKbSections().size, 0);
  assert.equal(isInformesSectionEnabled("choferes"), false);
  assert.ok(listInformesArticleCatalog({ structuralOnly: true }).length >= 8);
  assert.equal(getInformesArticlesByIds(["inf-idx-choferes"]).length, 0);
  assert.equal(getInformesArticlesByIds(["inf-ch-km"]).length, 0);
  assert.match(buildInformesKnowledgeContext(["inf-mapa"]), /deshabilitada/i);
  assert.ok(INFORMES_ARTICLES.filter((a) => a.id.startsWith("inf-ch-")).length >= 9);
  assert.equal(detectInfoGuideKind("informes"), "informes");
  assert.equal(detectInfoGuideKind("menu informes"), "informes");
  assert.equal(
    detectInfoGuideKind("¿Cómo veo el informe de cargas de combustible?"),
    "informes",
  );
  assert.ok(INFORMES_ARTICLES.some((a) => a.id === "inf-mapa"));
  assert.ok(INFORMES_ARTICLES.some((a) => a.id === "inf-idx-combustible"));
  assert.equal(categoryFromInformesArticleId("inf-idx-choferes"), "choferes");

  // Contrato 3 etapas: con todas las secciones on, el 1er payload NO lista las 89.
  process.env.WARA_INFORMES_KB_ENABLED = "true";
  process.env.WARA_INFORMES_KB_SECTIONS =
    "generales,choferes,combustible,mantenimiento_deposito,transporte_pasajeros,hojas_ruta,puntos";
  const catalogsAllOn = selectInformesCatalogsForInterpret({});
  assert.ok(catalogsAllOn.structural.length >= 8);
  assert.equal(catalogsAllOn.category, null);
  assert.equal(catalogsAllOn.categoryCatalog, null);
  assert.ok(
    !catalogsAllOn.structural.some((a) => a.id.startsWith("inf-ch-") && a.id !== "inf-idx-choferes"),
  );
  const catalogsCont = selectInformesCatalogsForInterpret({
    lastGuideCategory: "combustible",
    lastGuideReportId: "inf-cb-cargas",
  });
  assert.equal(catalogsCont.category, "combustible");
  assert.ok(catalogsCont.categoryCatalog?.some((a) => a.id === "inf-cb-cargas"));
  assert.ok(
    (catalogsCont.categoryCatalog ?? []).every(
      (a) =>
        a.category === "combustible" ||
        a.category === "mapa" ||
        a.category === "shared",
    ),
  );
  delete process.env.WARA_INFORMES_KB_ENABLED;
  delete process.env.WARA_INFORMES_KB_SECTIONS;

  const guideTool = buildAtilioAgentTools(false).find(
    (tool) => tool.function.name === "guia_informativa",
  );
  assert.match(guideTool?.function.description ?? "", /menú Informes/i);

  const forcedOff = await buildGroundedInfoGuideReplyWithMeta(
    "¿Cómo veo el informe de cargas de combustible?",
    "informes",
  );
  assert.equal(forcedOff.guideKind, "informes");
  assert.equal(forcedOff.fallback, "informes_flag_off");
  assert.equal((forcedOff.interpret?.articleIds ?? []).length, 0);
  assert.match(forcedOff.message, /no tengo habilitada la guía de Informes/i);
  assert.match(forcedOff.interpret?.reason ?? "", /informes_module_disabled/);

  const fromText = await buildGroundedInfoGuideReplyWithMeta(
    "¿Cómo veo el informe de cargas de combustible?",
  );
  assert.equal(fromText.guideKind, "informes");
  assert.equal(fromText.fallback, "informes_flag_off");

  const infGuard = applyPlatformGuideInterpretGuards(
    seed,
    "¿Cómo veo el informe de cargas de combustible?",
    "",
  );
  assert.equal(infGuard.guideKind, "informes");
  assert.equal(infGuard.category, "combustible");
  assert.equal(infGuard.articleIds.length, 0);
  assert.match(infGuard.reason ?? "", /informes_module_disabled|informes_catalog/);
  assert.equal(shouldRouteInterpretToInfoGuides(infGuard), true);

  const exec = await resolveTurnExecutor(
    "¿Cómo veo el informe de cargas de combustible?",
    "",
    null,
  );
  assert.equal(exec.executor, "info_guides");

  // CONFIRMO pending certificate still not informes
  const pendingCertificate = {
    type: "certificados",
    createdAt: new Date().toISOString(),
    payload: {
      stage: "confirmation_required",
      plate: "AG228NZ",
      turnLayer: { activeExpectation: "confirmo" },
    },
  };
  const confirmBaseline = await resolveTurnExecutor(
    "CONFIRMO",
    "Respondé CONFIRMO o CANCELAR.",
    pendingCertificate,
  );
  assert.notEqual(confirmBaseline.executor, "info_guides");

  const parsedLast = parseLastInfoGuideContext({
    lastInfoGuide: {
      kind: "informes",
      category: "combustible",
      reportId: null,
      articleIds: ["inf-idx-combustible"],
      at: new Date().toISOString(),
    },
  });
  assert.equal(parsedLast?.kind, "informes");
  assert.equal(parsedLast?.category, "combustible");
  assert.equal(parsedLast?.reportId, null);
  assert.deepEqual(parsedLast?.articleIds, ["inf-idx-combustible"]);

  // Continuidad por reportId: follow-up conserva el informe concreto.
  const cont = applyPlatformGuideInterpretGuards(
    {
      route: "continue_normal",
      guideKind: null,
      need: "ambiguous",
      articleIds: [],
      clarifyQuestion: null,
      executionRequest: false,
      confidence: 0.4,
      reason: "seed",
    },
    "¿qué filtros tiene?",
    "Atilio: En Informes → Combustible → Cargas de combustible…",
    {
      lastGuideKind: "informes",
      lastGuideCategory: "combustible",
      lastGuideReportId: "inf-cb-cargas",
      lastGuideArticleIds: ["inf-cb-cargas"],
    },
  );
  assert.equal(cont.guideKind, "informes");
  assert.equal(cont.category, "combustible");
  // Con master off no entrega cuerpos, pero el reportId debe quedar para continuidad.
  assert.equal(cont.reportId, "inf-cb-cargas");

  // Master on + sections vacío: reconoce pero no entrega detalle inf-ch-*
  process.env.WARA_INFORMES_KB_ENABLED = "true";
  process.env.WARA_INFORMES_KB_SECTIONS = "";
  assert.equal(isInformesKbEnabled(), true);
  assert.equal(isInformesSectionEnabled("choferes"), false);
  assert.equal(getInformesArticlesByIds(["inf-ch-km"]).length, 0);
  assert.equal(getInformesArticlesByIds(["inf-idx-choferes"]).length, 0);

  const contOn = applyPlatformGuideInterpretGuards(
    {
      route: "continue_normal",
      guideKind: null,
      need: "ambiguous",
      articleIds: [],
      clarifyQuestion: null,
      executionRequest: false,
      confidence: 0.4,
      reason: "seed",
    },
    "¿qué filtros tiene ese informe?",
    "",
    {
      lastGuideKind: "informes",
      lastGuideCategory: "choferes",
      lastGuideReportId: "inf-ch-km",
      lastGuideArticleIds: ["inf-ch-km"],
    },
  );
  assert.equal(contOn.guideKind, "informes");
  assert.equal(contOn.category, "choferes");
  // Sección choferes no habilitada → no entrega, pero reportId de continuidad.
  assert.equal(contOn.reportId, "inf-ch-km");
  assert.equal(contOn.articleIds.length, 0);

  // Master on + section choferes: idx + detalle inf-ch-*; idx-combustible no; mapa/shared sí
  process.env.WARA_INFORMES_KB_SECTIONS = "choferes";
  assert.equal(isInformesSectionEnabled("choferes"), true);
  assert.equal(isInformesSectionEnabled("combustible"), false);
  assert.equal(isInformesSectionEnabled("mapa"), true);
  assert.ok(getInformesArticlesByIds(["inf-idx-choferes"]).some((a) => a.id === "inf-idx-choferes"));
  assert.ok(getInformesArticlesByIds(["inf-ch-km"]).some((a) => a.id === "inf-ch-km"));
  assert.ok(getInformesArticlesByIds(["inf-ch-conducta"]).some((a) => a.id === "inf-ch-conducta"));
  assert.equal(getInformesArticlesByIds(["inf-idx-combustible"]).length, 0);
  assert.ok(getInformesArticlesByIds(["inf-mapa"]).some((a) => a.id === "inf-mapa"));
  assert.ok(
    getInformesArticlesByIds(["inf-shared-filtros"]).some((a) => a.id === "inf-shared-filtros"),
  );
  assert.match(buildInformesKnowledgeContext(["inf-ch-km"]), /Kilómetros recorridos/i);
  assert.match(buildInformesKnowledgeContext(["inf-idx-choferes"]), /Choferes/i);
  assert.match(buildInformesSectionDisabledReply("combustible"), /Combustible/i);
  assert.match(buildInformesDisabledChannelReply(), /Informes/);

  const chCatalog = listInformesArticleCatalog({ category: "choferes" });
  assert.ok(chCatalog.some((a) => a.id === "inf-ch-perfil-manejo"));
  assert.ok(chCatalog.every((a) => !a.id.startsWith("inf-cb-")));

  const sectionGuard = applyPlatformGuideInterpretGuards(
    {
      route: "info_guides",
      guideKind: "informes",
      need: "procedure",
      articleIds: ["inf-idx-combustible"],
      clarifyQuestion: null,
      executionRequest: false,
      confidence: 0.9,
      reason: "seed",
      category: "combustible",
    },
    "informe de cargas de combustible",
    "",
  );
  assert.equal(sectionGuard.guideKind, "informes");
  assert.equal(sectionGuard.articleIds.length, 0);
  assert.match(sectionGuard.reason ?? "", /informes_section_disabled/);

  const choferesGuard = applyPlatformGuideInterpretGuards(
    {
      route: "info_guides",
      guideKind: "informes",
      need: "procedure",
      articleIds: ["inf-idx-choferes"],
      clarifyQuestion: null,
      executionRequest: false,
      confidence: 0.9,
      reason: "seed",
      category: "choferes",
    },
    "informe de choferes",
    "",
  );
  assert.equal(choferesGuard.guideKind, "informes");
  assert.ok(choferesGuard.articleIds.includes("inf-idx-choferes"));
  assert.doesNotMatch(choferesGuard.reason ?? "", /informes_section_disabled/);

  // Con SECTIONS=choferes, pedido concreto → detalle inf-ch-* (no solo índice)
  const kmGuard = applyPlatformGuideInterpretGuards(
    {
      route: "info_guides",
      guideKind: "informes",
      need: "procedure",
      articleIds: ["inf-idx-choferes"],
      clarifyQuestion: null,
      executionRequest: false,
      confidence: 0.9,
      reason: "seed",
      category: "choferes",
    },
    "¿Cómo veo el informe de kilómetros recorridos por chofer?",
    "",
  );
  assert.equal(kmGuard.guideKind, "informes");
  assert.equal(kmGuard.category, "choferes");
  assert.ok(
    kmGuard.articleIds.some((id) => id.startsWith("inf-ch-")),
    `expected inf-ch-* got ${JSON.stringify(kmGuard.articleIds)}`,
  );

  // SECTIONS vacío: no entregar inf-ch-*
  process.env.WARA_INFORMES_KB_SECTIONS = "";
  const kmOff = applyPlatformGuideInterpretGuards(
    {
      route: "info_guides",
      guideKind: "informes",
      need: "procedure",
      articleIds: ["inf-ch-km"],
      clarifyQuestion: null,
      executionRequest: false,
      confidence: 0.9,
      reason: "seed",
      category: "choferes",
    },
    "¿Cómo veo el informe de kilómetros recorridos por chofer?",
    "",
  );
  assert.equal(kmOff.articleIds.length, 0);
  assert.match(kmOff.reason ?? "", /informes_section_disabled/);

  // Ciclo 2: puntos + hojas_ruta
  process.env.WARA_INFORMES_KB_SECTIONS = "puntos,hojas_ruta";
  assert.equal(isInformesSectionEnabled("puntos"), true);
  assert.equal(isInformesSectionEnabled("hojas_ruta"), true);
  assert.equal(isInformesSectionEnabled("choferes"), false);
  assert.ok(getInformesArticlesByIds(["inf-pt-entradas-salidas"]).some((a) => a.id === "inf-pt-entradas-salidas"));
  assert.ok(getInformesArticlesByIds(["inf-hr-viajes-planificados"]).some((a) => a.id === "inf-hr-viajes-planificados"));
  assert.equal(getInformesArticlesByIds(["inf-ch-km"]).length, 0);
  assert.ok(INFORMES_ARTICLES.filter((a) => a.id.startsWith("inf-pt-")).length >= 4);
  assert.ok(INFORMES_ARTICLES.filter((a) => a.id.startsWith("inf-hr-")).length >= 3);

  const ptGuard = applyPlatformGuideInterpretGuards(
    {
      route: "info_guides",
      guideKind: "informes",
      need: "procedure",
      articleIds: ["inf-idx-puntos"],
      clarifyQuestion: null,
      executionRequest: false,
      confidence: 0.9,
      reason: "seed",
      category: "puntos",
    },
    "¿Cómo veo el informe de entradas y salidas de puntos?",
    "",
  );
  assert.ok(
    ptGuard.articleIds.some((id) => id.startsWith("inf-pt-")),
    `expected inf-pt-* got ${JSON.stringify(ptGuard.articleIds)}`,
  );

  const hrGuard = applyPlatformGuideInterpretGuards(
    {
      route: "info_guides",
      guideKind: "informes",
      need: "procedure",
      articleIds: ["inf-idx-hojas_ruta"],
      clarifyQuestion: null,
      executionRequest: false,
      confidence: 0.9,
      reason: "seed",
      category: "hojas_ruta",
    },
    "Quiero el informe de viajes planificados por hojas de ruta",
    "",
  );
  assert.ok(
    hrGuard.articleIds.some((id) => id.startsWith("inf-hr-")),
    `expected inf-hr-* got ${JSON.stringify(hrGuard.articleIds)}`,
  );

  process.env.WARA_INFORMES_KB_SECTIONS = "";
  assert.equal(getInformesArticlesByIds(["inf-pt-resumenes"]).length, 0);
  assert.equal(getInformesArticlesByIds(["inf-hr-detalle"]).length, 0);

  // Ciclo 3: combustible
  process.env.WARA_INFORMES_KB_SECTIONS = "combustible";
  assert.ok(INFORMES_ARTICLES.filter((a) => a.id.startsWith("inf-cb-")).length >= 9);
  assert.ok(getInformesArticlesByIds(["inf-cb-cargas"]).some((a) => a.id === "inf-cb-cargas"));
  assert.equal(getInformesArticlesByIds(["inf-ch-km"]).length, 0);
  const cbGuard = applyPlatformGuideInterpretGuards(
    {
      route: "info_guides",
      guideKind: "informes",
      need: "procedure",
      articleIds: ["inf-idx-combustible"],
      clarifyQuestion: null,
      executionRequest: false,
      confidence: 0.9,
      reason: "seed",
      category: "combustible",
    },
    "¿Cómo veo el informe de cargas de combustible?",
    "",
  );
  assert.ok(
    cbGuard.articleIds.some((id) => id.startsWith("inf-cb-")),
    `expected inf-cb-* got ${JSON.stringify(cbGuard.articleIds)}`,
  );

  process.env.WARA_INFORMES_KB_SECTIONS = "";
  assert.equal(getInformesArticlesByIds(["inf-cb-cargas"]).length, 0);

  // Ciclo 4: mantenimiento_deposito
  process.env.WARA_INFORMES_KB_SECTIONS = "mantenimiento_deposito";
  assert.ok(INFORMES_ARTICLES.filter((a) => a.id.startsWith("inf-md-")).length >= 14);
  assert.ok(getInformesArticlesByIds(["inf-md-ordenes-trabajo"]).some((a) => a.id === "inf-md-ordenes-trabajo"));
  const mdGuard = applyPlatformGuideInterpretGuards(
    {
      route: "info_guides",
      guideKind: "informes",
      need: "procedure",
      articleIds: ["inf-idx-mantenimiento_deposito"],
      clarifyQuestion: null,
      executionRequest: false,
      confidence: 0.9,
      reason: "seed",
      category: "mantenimiento_deposito",
    },
    "¿Cómo veo el informe de órdenes de trabajo de mantenimiento?",
    "",
  );
  assert.ok(
    mdGuard.articleIds.some((id) => id.startsWith("inf-md-")),
    `expected inf-md-* got ${JSON.stringify(mdGuard.articleIds)}`,
  );
  process.env.WARA_INFORMES_KB_SECTIONS = "";
  assert.equal(getInformesArticlesByIds(["inf-md-tareas"]).length, 0);

  // Ciclo 5: transporte_pasajeros
  process.env.WARA_INFORMES_KB_SECTIONS = "transporte_pasajeros";
  assert.ok(INFORMES_ARTICLES.filter((a) => a.id.startsWith("inf-tp-")).length >= 20);
  assert.ok(
    getInformesArticlesByIds(["inf-tp-planilla-horarios"]).some((a) => a.id === "inf-tp-planilla-horarios"),
  );
  const tpGuard = applyPlatformGuideInterpretGuards(
    {
      route: "info_guides",
      guideKind: "informes",
      need: "procedure",
      articleIds: ["inf-idx-transporte_pasajeros"],
      clarifyQuestion: null,
      executionRequest: false,
      confidence: 0.9,
      reason: "seed",
      category: "transporte_pasajeros",
    },
    "¿Cómo veo el informe de planilla de horarios de transporte de pasajeros?",
    "",
  );
  assert.ok(
    tpGuard.articleIds.some((id) => id.startsWith("inf-tp-")),
    `expected inf-tp-* got ${JSON.stringify(tpGuard.articleIds)}`,
  );
  process.env.WARA_INFORMES_KB_SECTIONS = "";
  assert.equal(getInformesArticlesByIds(["inf-tp-resumen-servicio"]).length, 0);

  // Ciclo 6: generales (entrega parcial por lotes)
  process.env.WARA_INFORMES_KB_SECTIONS = "generales";
  assert.ok(INFORMES_ARTICLES.filter((a) => a.id.startsWith("inf-gn-")).length >= 30);
  assert.equal(
    INFORMES_ARTICLES.filter((a) => Boolean(a.reportId)).length,
    89,
  );
  assert.ok(getInformesArticlesByIds(["inf-gn-historial"]).some((a) => a.id === "inf-gn-historial") ||
    getInformesArticlesByIds(["inf-gn-acoplados"]).some((a) => a.id === "inf-gn-acoplados"));
  const gnGuard = applyPlatformGuideInterpretGuards(
    {
      route: "info_guides",
      guideKind: "informes",
      need: "procedure",
      articleIds: ["inf-idx-generales"],
      clarifyQuestion: null,
      executionRequest: false,
      confidence: 0.9,
      reason: "seed",
      category: "generales",
    },
    "¿Cómo veo el informe de acoplados?",
    "",
  );
  assert.ok(
    gnGuard.articleIds.some((id) => id.startsWith("inf-gn-") || id === "inf-idx-generales"),
    `expected inf-gn-* got ${JSON.stringify(gnGuard.articleIds)}`,
  );
  process.env.WARA_INFORMES_KB_SECTIONS = "";
  assert.equal(getInformesArticlesByIds(["inf-gn-acoplados"]).length, 0);

  console.log("OK verify-informes-kb");
} finally {
  restoreEnv();
}
