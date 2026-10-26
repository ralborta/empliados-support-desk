/**
 * Mensaje de derivación según presencia de asesor.
 * Uso: npx tsx --test src/lib/advisorHandoff.presence.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ADVISOR_OFFLINE_SOON_REPLY,
  REGISTERED_ADVISOR_HANDOFF_REPLY,
  buildPresenceAwareAdvisorHandoffReply,
  withAdvisorOfflineNoticeIfNeeded,
} from "./advisorHandoff";

describe("buildPresenceAwareAdvisorHandoffReply", () => {
  it("con asesor en línea y caso → mensaje de siempre", () => {
    const text = buildPresenceAwareAdvisorHandoffReply({
      advisorOnline: true,
      caseRef: "398566",
      explicitAdvisorRequest: true,
    });
    assert.match(text, /Tu caso es \*#398566\*/);
    assert.match(text, /Un asesor de Atención al cliente lo va a revisar/);
    assert.doesNotMatch(text, /no hay un asesor conectado/);
  });

  it("sin asesor conectado → solo aviso de espera, con caso", () => {
    const text = buildPresenceAwareAdvisorHandoffReply({
      advisorOnline: false,
      caseRef: "398566",
      explicitAdvisorRequest: true,
    });
    assert.match(text, /Tu caso es \*#398566\*/);
    assert.match(text, /no hay un asesor conectado en línea/);
    assert.doesNotMatch(text, /lo va a revisar/);
    assert.doesNotMatch(text, /matr[ií]cula|menú/i);
  });

  it("con asesor y sin caso → derivación habitual", () => {
    const text = buildPresenceAwareAdvisorHandoffReply({
      advisorOnline: true,
      explicitAdvisorRequest: true,
    });
    assert.equal(text, REGISTERED_ADVISOR_HANDOFF_REPLY);
  });

  it("sin asesor y sin caso → solo offline", () => {
    const text = buildPresenceAwareAdvisorHandoffReply({ advisorOnline: false });
    assert.equal(text, ADVISOR_OFFLINE_SOON_REPLY);
  });
});

describe("withAdvisorOfflineNoticeIfNeeded", () => {
  it("no toca el texto si hay asesor en línea", () => {
    const src =
      "La unidad AD 306 F presenta falta de reporte. Un asesor de Atención al cliente lo va a revisar.";
    assert.equal(withAdvisorOfflineNoticeIfNeeded(src, true), src);
  });

  it("falta de reporte sin asesor → reemplaza la promesa de revisión", () => {
    const src =
      "La unidad AD 306 F presenta falta de reporte. Un asesor de Atención al cliente lo va a revisar.";
    const next = withAdvisorOfflineNoticeIfNeeded(src, false);
    assert.match(next, /falta de reporte/);
    assert.match(next, /no hay un asesor conectado/);
    assert.doesNotMatch(next, /lo va a revisar/);
  });
});
