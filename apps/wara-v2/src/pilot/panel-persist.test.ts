import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { persistPilotTurnToV1Panel } from "./panel-persist.js";

describe("persistPilotTurnToV1Panel", () => {
  it("no-op si no hay URL de panel V1", async () => {
    await persistPilotTurnToV1Panel({
      phone: "+5491133788190",
      inboundText: "Hola",
      outboundText: "Hola, ¿en qué te ayudo?",
      messageId: "test-persist-1",
      env: {},
    });
  });

  it("no usa el bridge de lab", async () => {
    await persistPilotTurnToV1Panel({
      phone: "+5491133788190",
      inboundText: "Hola",
      outboundText: "Hola",
      messageId: "test-persist-lab",
      env: { WARA_V2_BRIDGE_BASE_URL: "http://front-v2-lab:3000" },
    });
  });
});
