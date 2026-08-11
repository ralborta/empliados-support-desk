/**
 * Eval live OpenAI — solo con activación Fase 8 completa + OPENAI_API_KEY.
 * No usa .env de producción. Tráfico únicamente a api.openai.com.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { FakeModelAdapter } from "@wara-v2/orchestrator";
import { applyPhase8TestFlags, loadPhase8LlmActivation } from "./flags.js";
import { OpenAiChatAdapter } from "./openai-adapter.js";
import { clearNetworkAudit, getNetworkAudit } from "./network.js";
import { SYNTHETIC_FIXTURES } from "./dataset.js";
import { evaluateAdapter, compareFakeVsReal } from "./evaluate.js";

function loadLocalDevKey(): string | null {
  if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.length > 20) {
    return process.env.OPENAI_API_KEY;
  }
  // Solo .env.local del monorepo (nunca .env.vercel.prod / production)
  const p = resolve(process.cwd(), "../../.env.local");
  if (!existsSync(p)) return null;
  const raw = readFileSync(p, "utf8");
  const m = raw.match(/^OPENAI_API_KEY=(.+)$/m);
  if (!m) return null;
  const v = m[1]!.trim().replace(/^["']|["']$/g, "");
  return v.length > 20 ? v : null;
}

const live = process.env.WARA_V2_LLM_LIVE === "true";
const key = live ? loadLocalDevKey() : null;

describe("fase8 llm live eval (optional)", () => {
  if (!live || !key) {
    it("SKIP live: set WARA_V2_LLM_LIVE=true + OPENAI_API_KEY/.env.local", () => {
      assert.ok(true);
    });
    return;
  }

  it("eval fake + real sobre subset sintético; tráfico solo openai", async () => {
    clearNetworkAudit();
    applyPhase8TestFlags({
      OPENAI_API_KEY: key,
      WARA_V2_DATABASE_URL:
        process.env.WARA_V2_DATABASE_URL ??
        "postgresql://wara_v2:x@127.0.0.1:5433/wara_v2",
    });
    loadPhase8LlmActivation();

    const subset = SYNTHETIC_FIXTURES.filter((f) =>
      ["general", "odometer", "hostile", "incomplete"].includes(f.category),
    ).slice(0, 6);

    const fake = await evaluateAdapter(new FakeModelAdapter(), subset);
    const realAdapter = new OpenAiChatAdapter({ maxRetries: 1, timeoutMs: 20_000 });
    const real = await evaluateAdapter(realAdapter, subset);

    assert.ok(fake.summary.security_ok === fake.summary.total);
    assert.ok(real.summary.security_ok === real.summary.total);

    const hosts = new Set(getNetworkAudit().map((a) => a.hostname));
    for (const h of hosts) {
      assert.equal(h, "api.openai.com");
    }
    assert.ok(getNetworkAudit().length >= 1);

    const cmp = await compareFakeVsReal(realAdapter);
    assert.ok(cmp.fake.summary.total > 0);
    assert.ok(cmp.real.summary.security_ok > 0);
  });
});
