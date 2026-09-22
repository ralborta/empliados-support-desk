/**
 * Regresión: dominio explícito del turno > continuidad lastGuide / hilo MT.
 * Uso: npx tsx --test src/lib/guideContinuityPrecedence.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyPlatformGuideInterpretGuards } from "./infoGuideInterpretAI";
import type { PlatformKnowledgeInterpret } from "./infoGuideInterpretAI";
import {
  looksLikeExplicitGuideDomainSwitchAwayFrom,
  looksLikeMaintenanceGuideFollowupQuestion,
} from "./waraApi";

const MT_THREAD =
  "Cliente: ¿Cómo asigno un plan de mantenimiento?\n" +
  "Atilio: Para asignar un plan: Unidades → MIS ATAJOS → TAREAS. Utilidades → Mantenimiento.";

function baseInterpret(
  overrides: Partial<PlatformKnowledgeInterpret> = {},
): PlatformKnowledgeInterpret {
  return {
    route: "info_guides",
    guideKind: null,
    need: "ambiguous",
    articleIds: [],
    clarifyQuestion: null,
    executionRequest: false,
    confidence: 0.85,
    reason: "test_primary",
    category: null,
    reportId: null,
    normalTarget: null,
    ...overrides,
  };
}

describe("looksLikeMaintenanceGuideFollowupQuestion — dominio explícito", () => {
  it("rechaza transporte de pasajeros tras hilo de mantenimiento", () => {
    assert.equal(
      looksLikeMaintenanceGuideFollowupQuestion(
        "Me podés ayudar con transporte de pasajeros?",
        MT_THREAD,
      ),
      false,
    );
  });

  it("acepta follow-up real de la misma familia", () => {
    assert.equal(
      looksLikeMaintenanceGuideFollowupQuestion("¿Y después dónde la sigo?", MT_THREAD),
      true,
    );
  });

  it("detecta switch explícito lejos de mantenimiento", () => {
    assert.equal(
      looksLikeExplicitGuideDomainSwitchAwayFrom(
        "Me podés ayudar con transporte de pasajeros?",
        "mantenimiento",
      ),
      true,
    );
  });
});

describe("applyPlatformGuideInterpretGuards — precedencia de continuidad", () => {
  const mtOpts = {
    lastGuideKind: "mantenimiento" as const,
    lastGuideCategory: null,
    lastGuideReportId: null,
    lastGuideArticleIds: ["mt-concepto-y-mapa", "mt-panel-tareas"],
  };

  it("Mantenimiento → TP: no pisa transporte_publico ni hereda mt-*", () => {
    const next = applyPlatformGuideInterpretGuards(
      baseInterpret({
        guideKind: "transporte_publico",
        need: "procedure",
        articleIds: [],
        reason: "cross_family_frontier_checked:transporte_publico_modulo",
      }),
      "Me podés ayudar con transporte de pasajeros?",
      MT_THREAD,
      mtOpts,
    );
    assert.equal(next.guideKind, "transporte_publico");
    assert.equal(next.continuity?.continuityApplied, false);
    assert.equal(next.continuity?.continuityRejectedReason, "explicit_domain_switch");
    assert.equal(next.continuity?.finalGuideKind, "transporte_publico");
    assert.equal(next.continuity?.primaryGuideKind, "transporte_publico");
    assert.equal(next.continuity?.lastGuideKind, "mantenimiento");
    assert.ok(!next.articleIds.some((id) => id.startsWith("mt-")));
  });

  it("TP → Mantenimiento: primary mantenimiento no es pisado por lastGuide TP", () => {
    const next = applyPlatformGuideInterpretGuards(
      baseInterpret({
        guideKind: "mantenimiento",
        need: "definition",
        articleIds: ["mt-concepto-y-mapa"],
      }),
      "¿Qué es un mantenimiento?",
      "Cliente: transporte de pasajeros\nAtilio: Sí, ¿servicios, paradas o turnos?",
      {
        lastGuideKind: "transporte_publico",
        lastGuideArticleIds: ["tp-glosario"],
      },
    );
    assert.equal(next.guideKind, "mantenimiento");
    assert.ok(next.articleIds.some((id) => id.startsWith("mt-")));
    assert.ok(!next.articleIds.some((id) => id.startsWith("tp-")));
  });

  it("follow-up «¿y después?» conserva mantenimiento", () => {
    const next = applyPlatformGuideInterpretGuards(
      baseInterpret({
        guideKind: null,
        need: "ambiguous",
        route: "continue_normal",
      }),
      "¿Y después dónde la sigo?",
      MT_THREAD,
      mtOpts,
    );
    assert.equal(next.guideKind, "mantenimiento");
    assert.equal(next.continuity?.continuityApplied, true);
    assert.equal(next.continuity?.continuityIntent, "continue");
    assert.ok(next.articleIds.some((id) => id.startsWith("mt-")));
  });

  it("no hereda category/reportId de otra familia al rechazar", () => {
    const next = applyPlatformGuideInterpretGuards(
      baseInterpret({
        guideKind: "transporte_publico",
        need: "procedure",
        articleIds: [],
        category: null,
        reportId: null,
      }),
      "Me podés ayudar con transporte de pasajeros?",
      MT_THREAD,
      {
        ...mtOpts,
        lastGuideCategory: "mantenimiento_deposito",
        lastGuideReportId: "mt-panel-tareas",
      },
    );
    assert.equal(next.guideKind, "transporte_publico");
    assert.equal(next.category, null);
    assert.equal(next.reportId, null);
  });

  it("Unidades → TP: primary TP no cae a MT por hilo residual", () => {
    const next = applyPlatformGuideInterpretGuards(
      baseInterpret({
        guideKind: "transporte_publico",
        need: "ambiguous",
        clarifyQuestion: "¿Servicios, paradas o turnos?",
      }),
      "Me podés ayudar con transporte de pasajeros?",
      "Cliente: ¿Cómo muevo unidades entre grupos?\nAtilio: En Unidades…",
      {
        lastGuideKind: "unidades",
        lastGuideArticleIds: [],
      },
    );
    assert.equal(next.guideKind, "transporte_publico");
    assert.ok(!next.articleIds.some((id) => id.startsWith("mt-")));
  });

  it("reclamo vago sin módulo → pide aclaración", () => {
    const next = applyPlatformGuideInterpretGuards(
      baseInterpret({
        route: "info_guides",
        guideKind: null,
        need: "ambiguous",
        clarifyQuestion: null,
      }),
      "Se sigue repitiendo el mismo inconveniente",
      "",
    );
    assert.equal(next.guideKind, null);
    assert.equal(next.need, "ambiguous");
    assert.match(next.clarifyQuestion ?? "", /inconveniente|unidad/i);
    assert.doesNotMatch(next.clarifyQuestion ?? "", /matr[ií]cula|patente a cambiar/i);
  });

  it("reclamo vago no hereda Alertas ni menú", () => {
    const next = applyPlatformGuideInterpretGuards(
      baseInterpret({
        guideKind: "alertas",
        need: "ambiguous",
        articleIds: ["al-panico"],
        clarifyQuestion: null,
      }),
      "Se sigue repitiendo el mismo inconveniente",
      "Cliente: Alarmas\nKira: En Alertas ves eventos…",
      {
        lastGuideKind: "alertas",
        lastGuideArticleIds: ["al-panico"],
      },
    );
    assert.equal(next.guideKind, null);
    assert.deepEqual(next.articleIds, []);
    assert.equal(next.need, "ambiguous");
    assert.match(next.clarifyQuestion ?? "", /inconveniente|unidad/i);
    assert.equal(next.reason?.includes("ambiguous_issue_clarify"), true);
  });

  it("un solo incidente en historial → aclara con esa unidad", () => {
    const next = applyPlatformGuideInterpretGuards(
      baseInterpret({
        guideKind: "paneles",
        need: "ambiguous",
        articleIds: ["pn-alarmas"],
      }),
      "Se sigue repitiendo el mismo inconveniente",
      "Cliente: Estado AD427MC\nKira: AD 427 MC reporta hace 2 min.",
      { lastGuideKind: "paneles", lastGuideArticleIds: ["pn-alarmas"] },
    );
    assert.equal(next.guideKind, null);
    assert.match(next.clarifyQuestion ?? "", /AD\s*427\s*MC/i);
  });

  it("Alarmas previo + turno sin módulo → no inyecta Alertas", () => {
    const next = applyPlatformGuideInterpretGuards(
      baseInterpret({
        route: "continue_normal",
        guideKind: null,
        need: "procedure",
      }),
      "Se sigue repitiendo el mismo inconveniente",
      "Cliente: Alarmas\nKira: En Alertas ves pánico y zonas…",
      { lastGuideKind: "alertas", lastGuideArticleIds: ["al-panico"] },
    );
    assert.equal(next.guideKind, null);
    assert.equal(next.reason?.includes("alertas_continuity"), false);
  });

  it("follow-up real de mantenimiento no se convierte en aclaración", () => {
    const next = applyPlatformGuideInterpretGuards(
      baseInterpret({
        guideKind: "mantenimiento",
        need: "procedure",
        articleIds: ["mt-panel-tareas"],
      }),
      "¿Y después dónde la sigo?",
      MT_THREAD,
      mtOpts,
    );
    assert.equal(next.guideKind, "mantenimiento");
    assert.equal(next.reason?.includes("ambiguous_issue_clarify"), false);
  });

  it("GPS explícito no se convierte en guía residual", () => {
    const next = applyPlatformGuideInterpretGuards(
      baseInterpret({
        route: "continue_normal",
        guideKind: null,
        need: "procedure",
        normalTarget: "live_unit",
      }),
      "mostrame el GPS de AD 306 F",
      "Cliente: Se sigue repitiendo el mismo inconveniente\nKira: ¿Qué inconveniente…?",
      { lastGuideKind: "alertas", lastGuideArticleIds: ["al-panico"] },
    );
    assert.equal(next.guideKind, null);
    assert.equal(next.normalTarget, "live_unit");
    assert.equal(next.reason?.includes("ambiguous_issue_clarify"), false);
  });
});
