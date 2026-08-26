import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildAtilioAgentTools,
  resolveAgentToolName,
} from "./atilioAgentTools";
import { shouldRequireMaintenanceGuideTool } from "./atilioAgent";
import { buildInfoGuideReply, detectInfoGuideKind } from "./infoGuideReplies";
import { looksLikeMaintenanceAppGuideRequest } from "./waraApi";

const MAINT_GUIDE_THREAD = [
  "El modulo de mantenimiento sirve para gestionar tareas preventivas y correctivas:",
  "1. Preventivo: planes periódicos asociados a unidades.",
  "2. Correctivo: órdenes por falla o reparación puntual.",
  "3. El agendamiento se hace en la app Wara: Utilidades → Mantenimiento.",
  "Orientacion de uso como guia general.",
  "No genero un ticket por esta consulta.",
].join("\n");

describe("contrato tools mantenimiento (operativo off)", () => {
  it("no expone mantenimiento_operativo cuando flag off", () => {
    const tools = buildAtilioAgentTools(false);
    const names = tools.map((t) => t.function.name);
    assert.equal(names.includes("mantenimiento_operativo"), false);
    assert.equal(names.includes("guia_informativa"), true);
  });

  it("expone mantenimiento_operativo cuando flag on", () => {
    const tools = buildAtilioAgentTools(true);
    assert.equal(
      tools.some((t) => t.function.name === "mantenimiento_operativo"),
      true,
    );
  });

  it("redirige mantenimiento_operativo → guia_informativa con flag off", () => {
    assert.equal(resolveAgentToolName("mantenimiento_operativo", false), "guia_informativa");
    assert.equal(resolveAgentToolName("mantenimiento_operativo", true), "mantenimiento_operativo");
    assert.equal(resolveAgentToolName("guia_informativa", false), "guia_informativa");
  });
});

describe("shouldRequireMaintenanceGuideTool", () => {
  it("Mantenimiento → require guide con operativo off", () => {
    assert.equal(
      shouldRequireMaintenanceGuideTool({
        selectionText: "Mantenimiento",
        threadText: "",
        operativeEnabled: false,
      }),
      true,
    );
  });

  it("¿Cómo cargo el preventivo? → sí fuerza guía", () => {
    assert.equal(
      shouldRequireMaintenanceGuideTool({
        selectionText: "¿Cómo cargo el preventivo?",
        threadText: MAINT_GUIDE_THREAD,
        operativeEnabled: false,
      }),
      true,
    );
  });

  it("No pude cargar el mantenimiento → sí fuerza guía", () => {
    assert.equal(
      shouldRequireMaintenanceGuideTool({
        selectionText: "No pude cargar el mantenimiento",
        threadText: MAINT_GUIDE_THREAD,
        operativeEnabled: false,
      }),
      true,
    );
  });

  it("quiero programar correctivo → require guide con off", () => {
    assert.equal(
      shouldRequireMaintenanceGuideTool({
        selectionText: "Quiero programar un correctivo",
        threadText: "",
        operativeEnabled: false,
      }),
      true,
    );
  });

  it("con operativo on no fuerza guía por keyword operativa", () => {
    assert.equal(
      shouldRequireMaintenanceGuideTool({
        selectionText: "Quiero programar un correctivo",
        threadText: "",
        operativeEnabled: true,
      }),
      false,
    );
  });

  it("anaphora «No pude cargarlo» sola NO fuerza (agente resuelve semántica)", () => {
    assert.equal(
      shouldRequireMaintenanceGuideTool({
        selectionText: "No pude cargarlo",
        threadText: MAINT_GUIDE_THREAD,
        operativeEnabled: false,
      }),
      false,
    );
  });
});

describe("regresión post-guía mantenimiento: tema nuevo no fuerza guía", () => {
  const cases: Array<{ inbound: string; force: boolean }> = [
    { inbound: "Quiero un certificado", force: false },
    { inbound: "Revisá el GPS", force: false },
    { inbound: "No quiero hacer un odómetro", force: false },
    { inbound: "Cambiar empresa", force: false },
    { inbound: "¿Cómo cargo el preventivo?", force: true },
    { inbound: "No pude cargar el mantenimiento", force: true },
  ];

  for (const c of cases) {
    it(`tras guía: «${c.inbound}» → force=${c.force}`, () => {
      assert.equal(
        shouldRequireMaintenanceGuideTool({
          selectionText: c.inbound,
          threadText: MAINT_GUIDE_THREAD,
          operativeEnabled: false,
        }),
        c.force,
      );
    });
  }
});

describe("guía autoservicio (fuente de verdad)", () => {
  it("Mantenimiento → intro app, sin pedir unidad ni programar por WA", () => {
    const msg = buildInfoGuideReply("Mantenimiento", "mantenimiento");
    assert.match(msg, /Utilidades → Mantenimiento|app Wara/i);
    assert.doesNotMatch(msg, /patente|unidad necesitas|programar.*WhatsApp|por este chat program/i);
    assert.match(msg, /no programo ni registro|app Wara/i);
  });

  it("Cómo cargo un preventivo → paso a paso", () => {
    assert.equal(detectInfoGuideKind("Cómo cargo un preventivo"), "mantenimiento");
    const msg = buildInfoGuideReply("Cómo cargo un preventivo", "mantenimiento");
    assert.match(msg, /preventiv/i);
    assert.match(msg, /Utilidades → Mantenimiento/);
    assert.doesNotMatch(msg, /¿Para qué unidad/i);
  });

  it("Quiero programar un correctivo → desde WARA, no WA", () => {
    assert.equal(looksLikeMaintenanceAppGuideRequest("Quiero programar un correctivo"), true);
    const msg = buildInfoGuideReply("Quiero programar un correctivo", "mantenimiento");
    assert.match(msg, /correctiv|WARA|Wara/i);
    assert.match(msg, /no programo ni registro|se realiza desde WARA|app Wara/i);
    assert.doesNotMatch(msg, /pasame la patente|¿Para qué unidad/i);
  });

  it("No pude cargar el mantenimiento → troubleshooting sin ticket automático", () => {
    const msg = buildInfoGuideReply("No pude cargar el mantenimiento", "mantenimiento");
    assert.match(msg, /probá esto|Utilidades → Mantenimiento/i);
    assert.match(msg, /no registro ni abro ticket automático/i);
  });
});
