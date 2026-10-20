import assert from "node:assert/strict";
import { it } from "node:test";
import { checkCleanMigration, parseCleanMigrationMode, renderCleanMigration, runCleanMigration } from "../migrations/migration-runner.js";

it("accepts the pnpm argument separator without changing migration mode", () => {
  assert.equal(parseCleanMigrationMode(["--", "--check"]), "check");
  assert.equal(parseCleanMigrationMode(["--", "--dry-run"]), "dry-run");
  assert.equal(parseCleanMigrationMode(["--apply"]), "apply");
  assert.throws(() => parseCleanMigrationMode(["--", "--unknown"]), /CLEAN_MIGRATION_MODE_INVALID/);
});

it("renders only a validated namespace and supports dry-run/check without applying", async () => {
  let applied = 0;
  const dry = await runCleanMigration({ namespace: "clean_test", mode: "dry-run", admin: { executeScript: async () => { applied++; } } });
  assert.equal(dry.mode, "dry-run"); assert.equal(dry.sql.includes("__CLEAN_SCHEMA__"), false); assert.equal(dry.sql.includes("clean_test.commit_turn"), true); assert.equal(applied, 0);
  const checked = await runCleanMigration({ namespace: "clean_test", mode: "check", admin: { executeScript: async () => { applied++; } } });
  assert.equal(checked.check.valid, true); assert.equal(applied, 0);
});
it("rejects unsafe namespaces, missing placeholders and incomplete SQL", async () => {
  await assert.rejects(renderCleanMigration("clean;drop"), /UNSAFE_NAMESPACE/);
  await assert.rejects(renderCleanMigration("clean_test", "select 1"), /PLACEHOLDER_MISSING/);
  assert.throws(() => checkCleanMigration("select 1", "clean_test"), /INCOMPLETE/);
  await assert.rejects(runCleanMigration({ namespace: "clean_test", mode: "apply" }), /ADMIN_REQUIRED/);
});
it("applies only through an explicitly supplied admin", async () => {
  let sql = ""; await runCleanMigration({ namespace: "clean_test", mode: "apply", admin: { executeScript: async (value) => { sql = value; } } });
  assert.equal(sql.includes("clean_test.load_snapshot"), true);
});
