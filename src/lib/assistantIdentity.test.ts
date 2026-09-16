/**
 * Regresión: identidad Kira vs ingreso/cargar número (loop Soy Kira 2026-09-15).
 * Uso: npx tsx --test src/lib/assistantIdentity.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildAssistantIdentityReply,
  buildPlatformAccessOrPhoneRegisterReply,
  looksLikeAssistantIdentityQuestion,
  looksLikePlatformAccessOrPhoneRegisterQuestion,
} from "./assistantIdentity";

describe("looksLikeAssistantIdentityQuestion", () => {
  it("acepta presentación social", () => {
    for (const t of [
      "Preséntate",
      "Presentate",
      "¿Quién sos?",
      "Cómo te llamás",
      "Cuál es tu nombre",
      "¿Cómo es tu nombre?",
    ]) {
      assert.equal(looksLikeAssistantIdentityQuestion(t), true, t);
    }
  });

  it("rechaza ingreso / cargar número / reconocimiento (loop prod)", () => {
    for (const t of [
      "Cómo ingreso a la plataforma?",
      "Quiero información sobre el informe de kilómetros muertos",
      "Cómo cargo mi número para que reconozcas que soy cliente?",
      "Cómo cargo mi numero para que reconozcas que soy cliente",
      "Cuál es la función del módulo de paneles?",
      "Necesito más información sobre estás funciones",
    ]) {
      assert.equal(looksLikeAssistantIdentityQuestion(t), false, t);
    }
  });
});

describe("looksLikePlatformAccessOrPhoneRegisterQuestion", () => {
  it("detecta acceso y registro de teléfono", () => {
    assert.equal(
      looksLikePlatformAccessOrPhoneRegisterQuestion("Cómo ingreso a la plataforma?"),
      true,
    );
    assert.equal(
      looksLikePlatformAccessOrPhoneRegisterQuestion(
        "Cómo cargo mi número para que reconozcas que soy cliente?",
      ),
      true,
    );
  });

  it("no confunde con Preséntate", () => {
    assert.equal(looksLikePlatformAccessOrPhoneRegisterQuestion("Preséntate"), false);
    assert.equal(looksLikePlatformAccessOrPhoneRegisterQuestion("Quién sos"), false);
  });
});

describe("replies", () => {
  it("identidad es Soy Kira", () => {
    assert.match(buildAssistantIdentityReply(), /^Soy Kira,/);
  });

  it("acceso/número incluye guía PDF", () => {
    const msg = buildPlatformAccessOrPhoneRegisterReply(
      "Cómo cargo mi número para que reconozcas que soy cliente?",
    );
    assert.match(msg, /\[\[MEDIA_URL\]\].*como-cargo-mi-numero-en-wara\.pdf/);
    assert.match(msg, /Agenda/i);
    assert.doesNotMatch(msg, /^Soy Kira/);
  });
});
