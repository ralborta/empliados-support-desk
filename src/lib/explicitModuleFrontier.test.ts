/**
 * Regresión: frontera no secuestra «Mantenimiento» / «módulo Mantenimiento» a TP/Paneles.
 * Uso: npx tsx --test src/lib/explicitModuleFrontier.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveExplicitPlatformGuideModule } from "./waraApi";
import { applyPlatformGuideInterpretGuards } from "./infoGuideInterpretAI";
import type { PlatformKnowledgeInterpret } from "./infoGuideInterpretAI";

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
    confidence: 0.8,
    reason: "test",
    category: null,
    reportId: null,
    normalTarget: null,
    ...overrides,
  };
}

describe("resolveExplicitPlatformGuideModule", () => {
  it("pick corto Mantenimiento", () => {
    assert.equal(resolveExplicitPlatformGuideModule("Mantenimiento"), "mantenimiento");
  });

  it("información sobre el módulo Mantenimiento", () => {
    assert.equal(
      resolveExplicitPlatformGuideModule(
        "Quiero información sobre el módulo Mantenimiento de Wara",
      ),
      "mantenimiento",
    );
  });

  it("no confunde follow-up genérico", () => {
    assert.equal(resolveExplicitPlatformGuideModule("¿Y después cómo sigo?"), null);
  });

  it("transporte de pasajeros con ayuda", () => {
    assert.equal(
      resolveExplicitPlatformGuideModule(
        "Me podés ayudar con el módulo de transporte de pasajeros?",
      ),
      "transporte_publico",
    );
  });
});

describe("explicit module vs residual continuity", () => {
  it("ancla MT aunque lastGuide sea opciones", () => {
    // Simula post-anclaje: primary ya MT; continuidad no debe heredar opciones.
    const next = applyPlatformGuideInterpretGuards(
      baseInterpret({
        guideKind: "mantenimiento",
        need: "definition",
        articleIds: ["mt-concepto-y-mapa"],
        reason: "explicit_module_anchor:mantenimiento",
      }),
      "Quiero información sobre el módulo Mantenimiento de Wara",
      "Cliente: Opciones\nKira: …",
      { lastGuideKind: "opciones", lastGuideArticleIds: [] },
    );
    assert.equal(next.guideKind, "mantenimiento");
    assert.ok(next.articleIds.some((id) => id.startsWith("mt-")));
    assert.equal(next.continuity?.continuityRejectedReason, "explicit_domain_switch");
  });
});
