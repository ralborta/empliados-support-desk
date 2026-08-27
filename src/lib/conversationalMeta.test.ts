/**
 * Regresión: meta-conversacional e idle follow-up (presencia, pushback, contexto).
 * Uso: npx tsx --test src/lib/conversationalMeta.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  looksLikeMetaConversationalReply,
  looksLikeSubstantiveCustomerMessage,
} from "./waraApi";
import {
  IDLE_CLOSE_MESSAGE,
  IDLE_NUDGE_MESSAGE,
  buildIdleFollowupPushbackReply,
  buildMetaConversationalContinuityReply,
  looksLikeIdleFollowupPushbackCandidate,
  resolveIdleFollowupMetaTurn,
  shouldHandleIdleFollowupPushback,
  threadLastBotOutboundWasIdleClose,
  threadLastBotOutboundWasIdleNudge,
} from "./idleFollowupMeta";
import {
  extractFreeTextUnitSearchCandidate,
  looksLikeFleetUnitSearchInput,
} from "./waraUnitIntent";

function threadWithClose(pushback?: string): string {
  const lines = [
    "Atilio: Para el certificado necesito la patente o unidad.",
    `Atilio: ${IDLE_NUDGE_MESSAGE}`,
    `Atilio: ${IDLE_CLOSE_MESSAGE}`,
  ];
  if (pushback) lines.push(`Cliente: ${pushback}`);
  return lines.join("\n");
}

describe("looksLikeMetaConversationalReply", () => {
  it("detecta presencia tras nudge idle", () => {
    assert.equal(looksLikeMetaConversationalReply("Sigo acá"), true);
    assert.equal(looksLikeMetaConversationalReply("estoy acá"), true);
    assert.equal(looksLikeMetaConversationalReply("presente"), true);
  });

  it("no busca «Sigo acá» en flota", () => {
    assert.equal(extractFreeTextUnitSearchCandidate("Sigo acá"), null);
    assert.equal(looksLikeFleetUnitSearchInput("Sigo acá"), false);
    assert.equal(looksLikeSubstantiveCustomerMessage("Sigo acá"), false);
  });
});

describe("looksLikeIdleFollowupPushbackCandidate", () => {
  it("detecta variantes y typos de reclamo", () => {
    assert.equal(looksLikeIdleFollowupPushbackCandidate("Cómo que no obtuviste respuesta"), true);
    assert.equal(looksLikeIdleFollowupPushbackCandidate("como q no"), true);
    assert.equal(looksLikeIdleFollowupPushbackCandidate("pero si respondí"), true);
    assert.equal(looksLikeIdleFollowupPushbackCandidate("te conteste"), true);
    assert.equal(looksLikeIdleFollowupPushbackCandidate("no me cierres"), true);
    assert.equal(looksLikeIdleFollowupPushbackCandidate("Me cerraste y sí te escribí"), true);
  });

  it("no confunde con consulta operativa", () => {
    assert.equal(
      looksLikeIdleFollowupPushbackCandidate(
        "Cómo que no obtuviste respuesta, necesito el GPS de NKL 952",
      ),
      false,
    );
  });
});

describe("shouldHandleIdleFollowupPushback", () => {
  it("cierre reciente + reclamo → intercepta", () => {
    const thread = threadWithClose();
    assert.equal(
      shouldHandleIdleFollowupPushback("Cómo que no obtuviste respuesta", thread),
      true,
    );
  });

  it("sin cierre reciente → no intercepta aunque el texto sea reclamo", () => {
    assert.equal(
      shouldHandleIdleFollowupPushback("Si te respondí", "Atilio: Hola, ¿en qué te ayudo?"),
      false,
    );
  });

  it("cierre antiguo (hubo charla después) → no intercepta", () => {
    const thread = [
      `Atilio: ${IDLE_CLOSE_MESSAGE}`,
      "Cliente: ok",
      "Atilio: ¿En qué más te ayudo?",
      "Cliente: Si te respondí",
    ].join("\n");
    assert.equal(threadLastBotOutboundWasIdleClose(thread), false);
    assert.equal(shouldHandleIdleFollowupPushback("Si te respondí", thread), false);
  });

  it("«sigo acá» tras nudge no usa pushback idle", () => {
    const thread = `Atilio: ${IDLE_NUDGE_MESSAGE}`;
    assert.equal(shouldHandleIdleFollowupPushback("Sigo acá", thread), false);
    assert.equal(looksLikeMetaConversationalReply("Sigo acá"), true);
    assert.ok(
      resolveIdleFollowupMetaTurn({ selectionText: "Sigo acá", threadText: thread }),
    );
    assert.equal(threadLastBotOutboundWasIdleNudge(thread), true);
  });
});

describe("buildIdleFollowupPushbackReply", () => {
  it("respuesta segura sin afirmar que el cliente escribió", () => {
    const reply = buildIdleFollowupPushbackReply({
      threadText: threadWithClose(),
    });
    assert.match(reply, /Tenés razón en reclamarlo/);
    assert.match(reply, /automático por inactividad/);
    assert.doesNotMatch(reply, /porque no hayas escrito/i);
    assert.doesNotMatch(reply, /undefined/i);
  });

  it("nombre ausente → no genera undefined", () => {
    const reply = buildIdleFollowupPushbackReply({
      threadText: threadWithClose(),
      customerFirstName: undefined,
    });
    assert.doesNotMatch(reply, /undefined/i);
    assert.match(reply, /^Tenés razón/);
  });

  it("retoma trámite pendiente en el hilo", () => {
    const reply = buildIdleFollowupPushbackReply({
      threadText: threadWithClose(),
      customerFirstName: "Emii",
    });
    assert.match(reply, /Emii,/);
    assert.match(reply, /certificado/i);
    assert.match(reply, /Seguimos con/i);
  });

  it("dos cierres: segundo pushback no repite saludo genérico", () => {
    const first = buildIdleFollowupPushbackReply({
      threadText: threadWithClose(),
      customerFirstName: "Emii",
    });
    const thread2 = [
      threadWithClose(),
      "Cliente: Cómo que no obtuviste respuesta",
      `Atilio: ${first}`,
      `Atilio: ${IDLE_CLOSE_MESSAGE}`,
    ].join("\n");
    const second = buildIdleFollowupPushbackReply({
      threadText: thread2,
      customerFirstName: "Emii",
    });
    assert.match(second, /Tenés razón en reclamarlo/);
    assert.doesNotMatch(second, /Hola Emii/i);
    assert.doesNotMatch(second, /en qué te ayudo hoy/i);
  });
});

describe("resolveIdleFollowupMetaTurn (integración)", () => {
  it("pushback tras cierre → intercept + mensaje contextual", () => {
    const turn = resolveIdleFollowupMetaTurn({
      selectionText: "Cómo que no obtuviste respuesta",
      threadText: threadWithClose(),
      customerFirstName: "Emii",
    });
    assert.ok(turn);
    assert.equal(turn?.idlePushback, true);
    assert.match(turn!.message, /certificado/i);
  });

  it("presencia tras nudge → intercept sin pushback", () => {
    const thread = [
      "Atilio: Elegí GPS, certificado u odómetro.",
      `Atilio: ${IDLE_NUDGE_MESSAGE}`,
    ].join("\n");
    const turn = resolveIdleFollowupMetaTurn({
      selectionText: "Sigo acá",
      threadText: thread,
    });
    assert.ok(turn);
    assert.equal(turn?.idlePushback, false);
    assert.match(turn!.message, /Perfecto, Seguimos/i);
  });

  it("texto normal sin idle → null (router/agente)", () => {
    assert.equal(
      resolveIdleFollowupMetaTurn({
        selectionText: "Necesito el GPS de NKL 952",
        threadText: "Atilio: Hola",
      }),
      null,
    );
  });
});

describe("buildMetaConversationalContinuityReply", () => {
  it("nudge reciente retoma tema, no menú genérico vacío", () => {
    const thread = [
      "Atilio: Para el certificado necesito la patente.",
      `Atilio: ${IDLE_NUDGE_MESSAGE}`,
    ].join("\n");
    const reply = buildMetaConversationalContinuityReply(thread);
    assert.match(reply, /certificado/i);
  });
});
