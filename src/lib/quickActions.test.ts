import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildQuickActionCustomerMessage,
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
  });
});
