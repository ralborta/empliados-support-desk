import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { looksLikeCustomerConversationCloseRequest } from "./customerConversationCloseDetect";

describe("customerConversationCloseDetect", () => {
  it("detecta pedidos reales de cierre de conversación", () => {
    assert.equal(
      looksLikeCustomerConversationCloseRequest("Quiero resolver la conversación"),
      true,
    );
    assert.equal(
      looksLikeCustomerConversationCloseRequest("Podés cerrar mi conversación?"),
      true,
    );
  });

  it("no trata gracias ni un problema técnico como cierre", () => {
    assert.equal(looksLikeCustomerConversationCloseRequest("Gracias"), false);
    assert.equal(
      looksLikeCustomerConversationCloseRequest("quiero resolver el problema del GPS"),
      false,
    );
  });
});
