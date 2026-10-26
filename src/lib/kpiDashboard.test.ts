import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  decodeKpiCursor,
  encodeKpiCursor,
  extractOdooFromPayload,
  inferModoResolucion,
  inferMotivoDerivacion,
} from "./kpiDashboard";

describe("kpiDashboard mapping", () => {
  it("extrae odooTicketId / ref desde payload", () => {
    assert.deepEqual(extractOdooFromPayload({ odooTicketId: 12345, odooRef: "12345" }), {
      odooTicketId: 12345,
      odooTicketRef: "12345",
    });
    assert.equal(extractOdooFromPayload({ odooRef: "#36248" }).odooTicketRef, "36248");
  });

  it("infiere modoResolucion idle / human / auto", () => {
    assert.equal(
      inferModoResolucion({
        status: "RESOLVED",
        resolvedByAI: true,
        resolution: "IDLE_TIMEOUT",
        assignedToUserId: null,
        hasHumanOutbound: false,
        hasEscalationEvent: false,
      }).modo,
      "IDLE_TIMEOUT",
    );
    assert.equal(
      inferModoResolucion({
        status: "IN_PROGRESS",
        resolvedByAI: false,
        resolution: null,
        assignedToUserId: "agent-1",
        hasHumanOutbound: false,
        hasEscalationEvent: false,
      }).modo,
      "HUMAN",
    );
    assert.equal(
      inferModoResolucion({
        status: "RESOLVED",
        resolvedByAI: true,
        resolution: null,
        assignedToUserId: null,
        hasHumanOutbound: false,
        hasEscalationEvent: false,
      }).modo,
      "KIRA_AUTO",
    );
  });

  it("motivoDerivacion null salvo HUMAN con odoo", () => {
    assert.equal(inferMotivoDerivacion({ modo: "KIRA_AUTO", odooTicketId: 1 }), null);
    assert.equal(inferMotivoDerivacion({ modo: "HUMAN", odooTicketId: null }), null);
    assert.equal(
      inferMotivoDerivacion({ modo: "HUMAN", odooTicketId: 99 }),
      "REQUIERE_GESTION_HUMANA",
    );
  });

  it("cursor roundtrip", () => {
    const c = { updatedAt: "2026-10-02T14:03:11.000Z", id: "abc" };
    assert.deepEqual(decodeKpiCursor(encodeKpiCursor(c)), c);
    assert.equal(decodeKpiCursor("nope"), null);
  });
});
