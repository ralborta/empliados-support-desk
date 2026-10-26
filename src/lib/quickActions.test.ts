import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildQuickActionCustomerMessage,
  isL1AdminDerivationAction,
  quickActionTicketPatch,
} from "./quickActions";

describe("quickActions", () => {
  it("arma mensaje al cliente para cada acción pública", () => {
    assert.ok(buildQuickActionCustomerMessage("request_data")?.includes("más datos"));
    assert.ok(buildQuickActionCustomerMessage("in_analysis")?.includes("análisis"));
    assert.ok(buildQuickActionCustomerMessage("derive")?.includes("Derivamos"));
    assert.ok(buildQuickActionCustomerMessage("resolve")?.includes("resuelta"));
    assert.ok(buildQuickActionCustomerMessage("close")?.includes("Cerramos"));
    assert.equal(buildQuickActionCustomerMessage("internal_note"), null);
    assert.match(
      buildQuickActionCustomerMessage("note_admin") ?? "",
      /Administración/i,
    );
    assert.match(
      buildQuickActionCustomerMessage("note_billing") ?? "",
      /Facturación/i,
    );
    assert.match(
      buildQuickActionCustomerMessage("note_collections") ?? "",
      /Cobranza/i,
    );
  });

  it("cambia estado del ticket según la acción", () => {
    assert.deepEqual(quickActionTicketPatch("request_data"), { status: "WAITING_CUSTOMER" });
    assert.deepEqual(quickActionTicketPatch("in_analysis"), { status: "IN_PROGRESS" });
    assert.deepEqual(quickActionTicketPatch("derive"), {
      status: "IN_PROGRESS",
      resolution: "BACKOFFICE_DERIVED",
    });
    assert.deepEqual(quickActionTicketPatch("resolve"), {
      status: "RESOLVED",
      resolution: "CHAT_RESOLVED",
    });
    assert.deepEqual(quickActionTicketPatch("close"), {
      status: "CLOSED",
      resolution: "CLOSED_NO_ACTION",
    });
    assert.deepEqual(quickActionTicketPatch("internal_note"), {});
    assert.deepEqual(quickActionTicketPatch("note_admin"), {
      status: "RESOLVED",
      resolution: "ADMIN_DERIVATION_L1",
      incidentType: "ADMIN_DERIVATION",
    });
    assert.equal(isL1AdminDerivationAction("note_collections"), true);
    assert.equal(isL1AdminDerivationAction("resolve"), false);
  });
});
