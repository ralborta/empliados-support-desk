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
  buildIdleNudgeAffirmationReply,
  buildMetaConversationalContinuityReply,
  looksLikeIdleFollowupPushbackCandidate,
  looksLikeIdleNudgeAffirmation,
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

  it("«Si» tras nudge idle → retoma tema previo, no replay GPS", () => {
    const thread = [
      "Atilio: El estado GPS de la unidad NKL 952 es el siguiente...",
      `Atilio: ${IDLE_NUDGE_MESSAGE}`,
    ].join("\n");
    assert.equal(looksLikeIdleNudgeAffirmation("Si", thread), true);
    const turn = resolveIdleFollowupMetaTurn({ selectionText: "Si", threadText: thread });
    assert.ok(turn);
    assert.equal(turn?.idlePushback, false);
    assert.match(turn!.message, /Seguimos con la consulta de unidad\/GPS/i);
    assert.doesNotMatch(turn!.message, /NKL 952|Estado GPS/i);
  });

  it("«Si, sigo aqui» tras nudge idle → afirmación + continuidad", () => {
    const thread = [
      "Atilio: ¿Querés que te explique cómo crear una hoja de ruta?",
      `Atilio: ${IDLE_NUDGE_MESSAGE}`,
    ].join("\n");
    assert.equal(looksLikeIdleNudgeAffirmation("Si, sigo aqui", thread), true);
    const turn = resolveIdleFollowupMetaTurn({
      selectionText: "Si, sigo aqui",
      threadText: thread,
    });
    assert.ok(turn);
    assert.equal(turn?.idlePushback, false);
    assert.match(turn!.message, /Perfecto/i);
    assert.match(turn!.message, /Hojas de ruta/i);
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
    assert.match(turn!.message, /Perfecto, seguimos/i);
    // Menú genérico no debe inventar trámite.
    assert.doesNotMatch(turn!.message, /Pasame la patente/i);
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

  it("bug Emii: menú+TP+nudge+«cuéntame más» NO salta a certificado", () => {
    const thread = [
      "Atilio: ¿En qué te ayudo?",
      "Atilio: • Odómetro / horómetro",
      "Atilio: • Certificado",
      "Atilio: • GPS / reporte",
      "Atilio: • Mantenimiento",
      "Atilio: • Transporte de pasajeros",
      "Cliente: Transporte de pasajeros",
      "Atilio: El servicio de Transporte de pasajeros te permite gestionar rutas, horarios y el cumplimiento del servicio en tiempo real. Se apoya en tres pilares: el servicio, el turno y la hoja de turno.",
      `Atilio: ${IDLE_NUDGE_MESSAGE}`,
    ].join("\n");
    const turn = resolveIdleFollowupMetaTurn({
      selectionText: "Sigo acá, cuéntame mas",
      threadText: thread,
      customerFirstName: "Emii",
    });
    assert.ok(turn);
    assert.equal(turn?.idlePushback, false);
    assert.match(turn!.message, /Emii,/);
    assert.match(turn!.message, /Transporte de pasajeros/i);
    assert.doesNotMatch(turn!.message, /certificado/i);
    assert.doesNotMatch(turn!.message, /Pasame la patente/i);
  });

  it("pendingAction residual certificado + TP reciente → pregunta fork, no retoma cert", () => {
    const thread = [
      "Atilio: ¿En qué te ayudo?\n• Certificado\n• Transporte de pasajeros",
      "Cliente: Transporte de pasajeros",
      "Atilio: El servicio de Transporte de pasajeros te permite gestionar rutas, horarios y la hoja de turno.",
      `Atilio: ${IDLE_NUDGE_MESSAGE}`,
    ].join("\n");
    const pending = {
      type: "certificados" as const,
      payload: { stage: "awaiting_unit" },
      createdAt: new Date().toISOString(),
    };
    const turn = resolveIdleFollowupMetaTurn({
      selectionText: "Sigo acá, cuéntame mas",
      threadText: thread,
      customerFirstName: "Emii",
      pendingAction: pending,
    });
    assert.ok(turn);
    assert.equal(turn!.preferGuideOverPending, true);
    assert.match(turn!.message, /Transporte de pasajeros/i);
    assert.match(turn!.message, /certificado pendiente/i);
    assert.doesNotMatch(turn!.message, /Pasame la patente/i);

    // Metadato estructurado también gana aunque el hilo sea ambiguo.
    const withMeta = resolveIdleFollowupMetaTurn({
      selectionText: "Sigo acá",
      threadText: [
        "Atilio: ¿En qué te ayudo?\n• Certificado\n• GPS",
        `Atilio: ${IDLE_NUDGE_MESSAGE}`,
      ].join("\n"),
      pendingAction: pending,
      lastGuideKind: "transporte_publico",
    });
    assert.ok(withMeta);
    assert.equal(withMeta!.preferGuideOverPending, true);
    assert.match(withMeta!.message, /Transporte de pasajeros/i);
    assert.match(withMeta!.message, /certificado pendiente/i);
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

  it("menú de capacidades solo → pregunta en qué seguir, no certificado", () => {
    const thread = [
      "Atilio: ¿En qué te ayudo?\n• Odómetro / horómetro\n• Certificado\n• GPS / reporte\n• Mantenimiento\n• Transporte de pasajeros",
      `Atilio: ${IDLE_NUDGE_MESSAGE}`,
    ].join("\n");
    const reply = buildMetaConversationalContinuityReply(thread, {
      selectionText: "Sigo acá",
    });
    assert.doesNotMatch(reply, /certificado/i);
    assert.match(reply, /En qué seguimos|En qué te ayudo|qué necesitás/i);
  });
});
