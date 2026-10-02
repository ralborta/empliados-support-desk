/**
 * Regresión: residual Paneles→Alarmas no debe contaminar saludo / reinicio / "1".
 * Uso: npx tsx --test src/lib/panelesContinuity.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { looksLikePanelesGuideFollowupQuestion } from "./panelesKnowledge";
import { applyPlatformGuideInterpretGuards } from "./infoGuideInterpretAI";
import { looksLikeGreeting } from "./waraApi";
import type { PlatformKnowledgeInterpret } from "./infoGuideInterpretAI";

function baseInterpret(
  overrides: Partial<PlatformKnowledgeInterpret> = {},
): PlatformKnowledgeInterpret {
  return {
    route: "info_guides",
    guideKind: null,
    need: "ambiguous",
    articleIds: [],
    clarifyQuestion: "¿Necesitás algo de la plataforma?",
    executionRequest: false,
    confidence: 0.8,
    reason: "test",
    category: null,
    reportId: null,
    normalTarget: null,
    ...overrides,
  };
}

describe("looksLikePanelesGuideFollowupQuestion", () => {
  it("rechaza saludo, reinicio y dígito suelto", () => {
    assert.equal(
      looksLikePanelesGuideFollowupQuestion("Cómo te va?", "", "paneles"),
      false,
    );
    assert.equal(
      looksLikePanelesGuideFollowupQuestion("reiniciar empresa", "", "paneles"),
      false,
    );
    assert.equal(looksLikePanelesGuideFollowupQuestion("1", "", "paneles"), false);
    assert.equal(looksLikePanelesGuideFollowupQuestion("Zi", "", "paneles"), false);
  });

  it("acepta follow-up de alarmas/paneles", () => {
    assert.equal(
      looksLikePanelesGuideFollowupQuestion("¿y cómo silencio la alarma?", "", "paneles"),
      true,
    );
    assert.equal(
      looksLikePanelesGuideFollowupQuestion("y después?", "", "paneles"),
      true,
    );
  });
});

describe("paneles_continuity residual", () => {
  const opts = {
    lastGuideKind: "paneles" as const,
    lastGuideReportId: "alarmas",
    lastGuideArticleIds: ["pn-alarmas"],
  };

  it("no reinyecta Alarmas ante saludo / reinicio / 1", () => {
    for (const text of ["Cómo te va?", "reiniciar empresa", "1"]) {
      const next = applyPlatformGuideInterpretGuards(baseInterpret(), text, "", opts);
      assert.notEqual(next.reason?.includes("paneles_continuity"), true, text);
      assert.deepEqual(next.articleIds, [], text);
    }
  });

  it("sí continúa ante follow-up de alarma", () => {
    const prev = process.env.WARA_PANELES_KB_ENABLED;
    process.env.WARA_PANELES_KB_ENABLED = "true";
    try {
      const next = applyPlatformGuideInterpretGuards(
        baseInterpret(),
        "¿cómo silencio la alarma?",
        "",
        opts,
      );
      assert.match(String(next.reason), /paneles_continuity/);
      assert.equal(next.guideKind, "paneles");
      assert.ok(next.articleIds.includes("pn-alarmas"));
    } finally {
      if (prev === undefined) delete process.env.WARA_PANELES_KB_ENABLED;
      else process.env.WARA_PANELES_KB_ENABLED = prev;
    }
  });
});

describe("looksLikeGreeting", () => {
  it("acepta cómo te va", () => {
    assert.equal(looksLikeGreeting("Cómo te va?"), true);
    assert.equal(looksLikeGreeting("como te va"), true);
  });
});
