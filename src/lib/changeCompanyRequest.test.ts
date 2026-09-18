/**
 * Regresión: «reiniciar empresa» debe ser change_company en todos los entrypoints.
 * Uso: npx tsx --test src/lib/changeCompanyRequest.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { looksLikeChangeCompanyRequest } from "./waraApi";
import { looksLikePanelesGuideFollowupQuestion } from "./panelesKnowledge";

describe("looksLikeChangeCompanyRequest", () => {
  it("acepta reiniciar / cambiar empresa (variantes)", () => {
    for (const t of [
      "reiniciar empresa",
      "Reiniciar empresa",
      "reiniciar empresa ",
      "reiniciar de empresa",
      "cambiar empresa",
      "cambiar de empresa",
      "quiero cambiar de empresa",
      "reiciar empresa",
      "reinicia empresa",
    ]) {
      assert.equal(looksLikeChangeCompanyRequest(t), true, t);
    }
  });

  it("no confunde con trámites", () => {
    assert.equal(looksLikeChangeCompanyRequest("necesito certificado"), false);
    assert.equal(looksLikeChangeCompanyRequest("estado de la unidad"), false);
  });
});

describe("reiniciar empresa vs paneles residual", () => {
  it("no es follow-up de Paneles", () => {
    assert.equal(
      looksLikePanelesGuideFollowupQuestion("reiniciar empresa", "", "paneles"),
      false,
    );
  });
});
