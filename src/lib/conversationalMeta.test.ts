/**
 * Regresión: mensajes meta-conversacionales no deben tratarse como búsqueda de unidad.
 * Uso: npx tsx --test src/lib/conversationalMeta.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  looksLikeMetaConversationalReply,
  looksLikeSubstantiveCustomerMessage,
} from "./waraApi";
import {
  buildMetaConversationalContinuityReply,
  IDLE_NUDGE_MESSAGE,
  threadHasRecentIdleNudge,
} from "./idleConversationFollowup";
import {
  extractFreeTextUnitSearchCandidate,
  looksLikeFleetUnitSearchInput,
} from "./waraUnitIntent";

describe("looksLikeMetaConversationalReply", () => {
  it("detecta presencia tras nudge idle", () => {
    assert.equal(looksLikeMetaConversationalReply("Sigo acá"), true);
    assert.equal(looksLikeMetaConversationalReply("estoy acá"), true);
    assert.equal(looksLikeMetaConversationalReply("acá estoy"), true);
    assert.equal(looksLikeMetaConversationalReply("presente"), true);
  });

  it("detecta demora sin trámite", () => {
    assert.equal(looksLikeMetaConversationalReply("disculpa la demora"), true);
    assert.equal(looksLikeMetaConversationalReply("dame un momento"), true);
  });

  it("no confunde con pedido operativo", () => {
    assert.equal(
      looksLikeMetaConversationalReply("sigo acá, necesito el certificado de NKL 952"),
      false,
    );
    assert.equal(looksLikeMetaConversationalReply("quiero seguir con El Cacique"), false);
  });

  it("no busca «Sigo acá» en flota", () => {
    assert.equal(extractFreeTextUnitSearchCandidate("Sigo acá"), null);
    assert.equal(looksLikeFleetUnitSearchInput("Sigo acá"), false);
    assert.equal(looksLikeSubstantiveCustomerMessage("Sigo acá"), false);
  });
});

describe("buildMetaConversationalContinuityReply", () => {
  it("retoma con menú tras nudge idle en el hilo", () => {
    const thread = `Atilio: ${IDLE_NUDGE_MESSAGE}\nCliente: Sigo acá`;
    assert.equal(threadHasRecentIdleNudge(thread), true);
    const reply = buildMetaConversationalContinuityReply(thread);
    assert.match(reply, /Perfecto, seguimos/);
    assert.match(reply, /GPS\/reporte/);
  });

  it("respuesta genérica sin nudge reciente", () => {
    assert.equal(buildMetaConversationalContinuityReply("Atilio: Hola"), "Dale, seguimos. ¿En qué te ayudo?");
  });
});
