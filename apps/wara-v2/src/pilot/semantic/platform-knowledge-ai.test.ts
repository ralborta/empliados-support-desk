import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isPlatformKnowledgeRefusal,
  platformStaticFallback,
  resolvePlatformGuideAnswer,
} from "./platform-knowledge-ai.js";
import { knowledgeForPlatformGuide } from "./platform-knowledge-base.js";
import {
  V1_MANTENIMIENTO_GUIDES,
  V1_OPCIONES_GUIDES,
  V1_UNIDADES_GUIDES,
} from "./v1-info-guides.js";

describe("platform knowledge paridad V1", () => {
  it("opciones incluye PDF V1 + plantillas Agenda/Notificaciones/Perfiles", () => {
    const kb = knowledgeForPlatformGuide("opciones");
    assert.match(kb, /Módulo Opciones: Agenda, Notificaciones y Perfiles/i);
    assert.match(kb, /PEGAR TABLA/);
    assert.match(kb, /Utilidades → Opciones → Perfiles/);
    assert.match(kb, /Utilidades → Opciones → Agenda/);
    assert.match(kb, /Utilidades → Opciones → Notificaciones/);
    assert.ok(kb.includes(V1_OPCIONES_GUIDES.slice(0, 80)));
  });

  it("unidades incluye PDF V1 + plantillas MIS ATAJOS/grupos/colores", () => {
    const kb = knowledgeForPlatformGuide("unidades");
    assert.match(kb, /Módulo de Unidades — Plataforma Wara/i);
    assert.match(kb, /MIS ATAJOS/);
    assert.match(kb, /Crear grupo/);
    assert.match(kb, /Verde: unidad activa/);
    assert.ok(kb.includes(V1_UNIDADES_GUIDES.slice(0, 80)));
  });

  it("mantenimiento incluye how-to V1 + ficha Unidades + consumo", () => {
    const kb = knowledgeForPlatformGuide("mantenimiento");
    assert.match(kb, /Módulo de Mantenimiento/i);
    assert.match(kb, /Utilidades → Mantenimiento/);
    assert.match(kb, /rendimiento teórico/i);
    assert.match(kb, /Tareas correctivas/i);
    assert.match(kb, /AGREGAR ORDEN DE TRABAJO/i);
    assert.match(kb, /MIS ATAJOS/i);
    assert.match(kb, /combustible|rendimiento/i);
    assert.ok(kb.includes(V1_MANTENIMIENTO_GUIDES.slice(0, 80)));
  });

  it("niega 'no tengo información' como negativa vacía", () => {
    assert.equal(
      isPlatformKnowledgeRefusal(
        "No tengo información sobre el módulo de mantenimiento. Puedo derivarte a un asesor si lo deseas.",
      ),
      true,
    );
  });

  it("unidad específica cae al fallback V1 de ficha Unidades", () => {
    const answer = resolvePlatformGuideAnswer(
      "No tengo información sobre el módulo de mantenimiento. Puedo derivarte a un asesor si lo deseas.",
      "mantenimiento",
      "¿Y podes guiarme para indicarme como hacerlo con una unidad en especifico?",
    );
    assert.doesNotMatch(answer, /No tengo informaci[oó]n/i);
    assert.match(answer, /chevron|MIS ATAJOS/i);
  });

  it("fallback preventivo usa how-to V1, no derivación vacía", () => {
    const text = platformStaticFallback("mantenimiento", "como hago un preventivo");
    assert.match(text, /preventivo/i);
    assert.match(text, /Utilidades → Mantenimiento|plan preventivo/i);
    assert.doesNotMatch(text, /No tengo informaci[oó]n/i);
  });

  it("fallback opciones perfiles es el texto V1", () => {
    const text = platformStaticFallback("opciones", "qué es un perfil");
    assert.match(text, /plantilla de permisos/i);
    assert.match(text, /Opciones → Perfiles/);
  });

  it("fallback unidades atajos es el texto V1", () => {
    const text = platformStaticFallback("unidades", "cómo veo el historial");
    assert.match(text, /MIS ATAJOS/i);
    assert.match(text, /chevron/i);
  });
});
