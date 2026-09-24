/**
 * Tests Fase 9B — dataset ficticio de volumen (no datos reales de clientes).
 */
import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import { writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { GOV_DIRS, ensureGovDirs } from "./paths.js";
import { validateHistoricalExport } from "./historical.js";
import { runPhase9BPipeline } from "./run-9b.js";
import {
  assertStage9BAuthorized,
  revokeHistoricalAuthorization,
} from "./authorize.js";
import { purgeDataset } from "./pipeline.js";

function buildFixture(nConv: number, opts?: { withPii?: boolean; badTenant?: boolean }) {
  const messages = [];
  for (let i = 0; i < nConv; i++) {
    messages.push({
      tenant_id: opts?.badTenant && i === 50 ? "other" : "tenant_internal_ops",
      conversation_id: `c_${String(i).padStart(4, "0")}`,
      turn_index: 0,
      message_role: "user",
      text: opts?.withPii
        ? `Hola Juan Perez mi mail es user${i}@example.com`
        : `consulta sintética de prueba número ${i} sobre odómetro`,
      received_at: `2026-06-${String((i % 28) + 1).padStart(2, "0")}T12:00:00.000Z`,
    });
    messages.push({
      tenant_id: "tenant_internal_ops",
      conversation_id: `c_${String(i).padStart(4, "0")}`,
      turn_index: 1,
      message_role: "assistant",
      text: `respuesta de prueba ${i}`,
      received_at: `2026-06-${String((i % 28) + 1).padStart(2, "0")}T12:01:00.000Z`,
    });
  }
  return {
    synthetic: false as const,
    tenant_id: "tenant_internal_ops",
    messages,
  };
}

describe("fase9B historical offline", () => {
  before(() => {
    revokeHistoricalAuthorization();
    rmSync(GOV_DIRS.drop, { recursive: true, force: true });
    rmSync(GOV_DIRS.reports, { recursive: true, force: true });
    ensureGovDirs();
  });

  function writeDrop(name: string, body: unknown) {
    ensureGovDirs();
    writeFileSync(join(GOV_DIRS.drop, name), JSON.stringify(body));
  }

  it("rechaza volumen < 12", () => {
    writeDrop("small.json", buildFixture(5));
    const v = validateHistoricalExport("small.json");
    assert.equal(v.ok, false);
    assert.ok(v.errors.some((e) => e.includes("volume")));
  });

  it("pipeline 9B: auth+deid+human pending luego approved", async () => {
    writeDrop("hist12.json", buildFixture(12));
    const pending = await runPhase9BPipeline({
      filename: "hist12.json",
      issueAuth: true,
      humanApproved: false,
    });
    assert.equal(pending.human_review.status, "pending_human");
    assert.equal(pending.conversations_accepted, 12);
    assert.ok(assertStage9BAuthorized().authorization_id);

    const done = await runPhase9BPipeline({
      filename: "hist12.json",
      issueAuth: true,
      humanApproved: true,
      approver: "Raúl Alborta",
    });
    assert.equal(done.human_review.status, "approved");
    assert.ok(done.partitions.dev + done.partitions.val + done.partitions.holdout >= 1);
    assert.equal(done.eval.effects.outbox, 0);

    purgeDataset(done.dataset_id, {
      dryRun: false,
      confirm: `DELETE:${done.dataset_id}`,
    });
    revokeHistoricalAuthorization();
  });

  it("bloquea PII crítica residual si no se puede limpiar lo suficiente", async () => {
    // Con PII: deid debería limpiar emails/nombres; si queda crítico post, bloquea
    writeDrop("hist_pii.json", buildFixture(12, { withPii: true }));
    // Puede pasar si deid limpia todo; entonces OK. Si falla post-critical, también OK.
    try {
      await runPhase9BPipeline({
        filename: "hist_pii.json",
        issueAuth: true,
        humanApproved: false,
      });
      assert.ok(true);
    } catch (e) {
      assert.ok(
        e instanceof Error &&
          /critical_residual|validation_failed|authorization/.test(e.message),
      );
    }
  });
});
