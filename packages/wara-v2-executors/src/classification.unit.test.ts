import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyAttemptResult,
  mayAutoRetry,
  requiresReconcile,
  assertLocalSimulatorUrl,
  GUARANTEES,
} from "./index.js";

describe("executors unit", () => {
  it("guarantees", () => {
    assert.equal(GUARANTEES.ALLOW_EXTERNAL_MUTATIONS, false);
    assert.equal(GUARANTEES.allowExternalEffectReal, false);
  });

  it("classification matrix", () => {
    assert.equal(
      classifyAttemptResult({
        requestLikelySent: true,
        httpStatus: 200,
        bodyOk: true,
      }),
      "success",
    );
    assert.equal(
      classifyAttemptResult({
        requestLikelySent: true,
        httpStatus: 422,
        bodyOk: true,
      }),
      "permanent_failure",
    );
    assert.equal(mayAutoRetry("unknown_outcome"), false);
    assert.equal(requiresReconcile("timeout_after_send"), true);
  });

  it("allowlist rejects credentials and non-loopback", () => {
    const ports = new Set([9]);
    assert.equal(
      assertLocalSimulatorUrl("http://127.0.0.1:9/x", ports).ok,
      true,
    );
    assert.equal(
      assertLocalSimulatorUrl("http://u:p@127.0.0.1:9/x", ports).ok,
      false,
    );
  });
});
