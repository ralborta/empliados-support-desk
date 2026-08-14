import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { inferTicketCategory } from "./ticket-core.js";

describe("inferTicketCategory", () => {
  it("no clasifica 'Usuario solicita derivación' como acceso/plataforma", () => {
    assert.equal(
      inferTicketCategory(
        "Usuario solicita derivación a un asesor debido a la falta de reporte reciente de la unidad M300-099.",
      ),
      "technical_support",
    );
  });

  it("login / no puedo entrar sigue siendo acceso", () => {
    assert.equal(
      inferTicketCategory("no puedo entrar a la plataforma"),
      "access_platform",
    );
  });

  it("derivar a un asesor sin otro motivo es asesor humano", () => {
    assert.equal(inferTicketCategory("derivar a un asesor"), "human_advisor");
  });
});
