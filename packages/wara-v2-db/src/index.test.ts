import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { V2_DEFAULT_MODE, V2_MUTATIONS_DISABLED, createWaraV2Prisma } from "./index.js";

describe("@wara-v2/db unit", () => {
  it("flags de seguridad Fase 2", () => {
    assert.equal(V2_MUTATIONS_DISABLED, true);
    assert.equal(V2_DEFAULT_MODE, "dry_run");
  });

  it("exige WARA_V2_DATABASE_URL", () => {
    assert.throws(() => createWaraV2Prisma(""), /WARA_V2_DATABASE_URL/);
  });
});
