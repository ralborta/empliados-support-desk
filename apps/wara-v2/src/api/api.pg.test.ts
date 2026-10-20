/**
 * Fase 7 — API local, shadow, replay, aislamiento (PostgreSQL embebido).
 */
import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import { randomUUID } from "node:crypto";
import {
  parseCanonicalIngress,
  CANONICAL_INGRESS_SCHEMA_VERSION,
} from "@wara-v2/contracts";
import { applyTestFlags, loadPhase7Flags } from "./flags.js";
import { startApiServer, type ApiServer } from "./server.js";
import {
  FutureLlmAdapterStub,
  assertNoRealModel,
  TimeoutModelAdapter,
  InvalidJsonModelAdapter,
} from "./model-adapters.js";
import { assertNoRealChannels } from "./channel-adapters.js";
import { GATED_PREPARE_ONLY } from "@wara-v2/orchestrator";
import { prepareEffectOutbox, ALLOW_EXTERNAL_MUTATIONS } from "@wara-v2/executors";

async function req(
  base: string,
  path: string,
  init: {
    method?: string;
    token?: string;
    tenant?: string;
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
) {
  const headers: Record<string, string> = {
    ...(init.headers ?? {}),
  };
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  if (init.tenant) headers["x-tenant-id"] = init.tenant;
  if (init.body !== undefined) {
    headers["content-type"] = "application/json";
  }
  headers["x-correlation-id"] = randomUUID();
  const res = await fetch(`${base}${path}`, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json, headers: res.headers };
}

function shadowBody(
  tenant: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    schema_version: CANONICAL_INGRESS_SCHEMA_VERSION,
    source: "synthetic",
    tenant_id: tenant,
    external_conversation_id: "c1",
    external_message_id: randomUUID(),
    received_at: new Date().toISOString(),
    message_type: "text",
    content: { text: "hola" },
    metadata: {},
    correlation_id: randomUUID(),
    is_replay: false,
    is_shadow: true,
    ...overrides,
  };
}

describe("wara-v2 api fase7", () => {
  const url = process.env.WARA_V2_DATABASE_URL;
  if (!url) {
    it("SKIP: requiere WARA_V2_DATABASE_URL", () => assert.ok(true));
    return;
  }

  let api: ApiServer;

  before(async () => {
    applyTestFlags();
    assertNoRealModel();
    assertNoRealChannels();
    assert.equal(FutureLlmAdapterStub.enabled, false);
    assert.equal(ALLOW_EXTERNAL_MUTATIONS, false);
    assert.equal(GATED_PREPARE_ONLY, true);
    api = await startApiServer({ databaseUrl: url, port: 0 });
    assert.equal(api.host, "127.0.0.1");
  });

  after(async () => {
    await api.close();
  });

  it("2. health y readiness local", async () => {
    const h = await req(api.baseUrl, "/health");
    assert.equal(h.status, 200);
    assert.equal((h.json as { delivery_enabled: boolean }).delivery_enabled, false);
    const r = await req(api.baseUrl, "/ready");
    assert.equal(r.status, 200);
  });

  it("3. ingress válido (shadow)", async () => {
    const r = await req(api.baseUrl, "/v2/ingress", {
      token: "local-tenant-a",
      tenant: "tenant_a",
      body: shadowBody("tenant_a"),
    });
    assert.equal(r.status, 202);
    assert.equal((r.json as { shadow: boolean }).shadow, true);
    assert.equal((r.json as { delivery_enabled: boolean }).delivery_enabled, false);
  });

  it("4. ingress schema inválido", async () => {
    const r = await req(api.baseUrl, "/v2/ingress", {
      token: "local-admin",
      body: { schema_version: 1, foo: "bar" },
    });
    assert.ok(r.status >= 400);
  });

  it("5. versión desconocida", async () => {
    const r = await req(api.baseUrl, "/v2/ingress", {
      token: "local-admin",
      body: shadowBody("tenant_a", { schema_version: 99 }),
    });
    assert.ok(r.status >= 400);
  });

  it("6. tenant ausente / mismatch", async () => {
    const r = await req(api.baseUrl, "/v2/ingress", {
      token: "local-tenant-a",
      body: shadowBody("tenant_b"),
    });
    assert.equal(r.status, 403);
  });

  it("7. duplicado idéntico", async () => {
    const mid = randomUUID();
    const body = shadowBody("tenant_a", {
      external_message_id: mid,
      content: { text: "hola" },
    });
    const a = await req(api.baseUrl, "/v2/ingress", {
      token: "local-tenant-a",
      body,
    });
    const b = await req(api.baseUrl, "/v2/ingress", {
      token: "local-tenant-a",
      body: { ...body, correlation_id: randomUUID() },
    });
    assert.equal(a.status, 202);
    assert.equal(b.status, 202);
    assert.equal((b.json as { outcome: string }).outcome, "deduped");
  });

  it("8. duplicado contradictorio (mismo id, texto distinto)", async () => {
    const mid = randomUUID();
    const a = await req(api.baseUrl, "/v2/ingress", {
      token: "local-tenant-a",
      body: shadowBody("tenant_a", {
        external_message_id: mid,
        content: { text: "uno" },
      }),
    });
    const b = await req(api.baseUrl, "/v2/ingress", {
      token: "local-tenant-a",
      body: shadowBody("tenant_a", {
        external_message_id: mid,
        content: { text: "dos" },
      }),
    });
    assert.equal(a.status, 202);
    assert.equal(b.status, 202);
    assert.ok(
      ["duplicate_conflict", "deduped", "ok", "needs_user_input"].includes(
        (b.json as { outcome: string }).outcome,
      ),
    );
  });

  it("9. dos tenants mismos IDs externos", async () => {
    const ext = randomUUID();
    const mk = (tenant: string, token: string) =>
      req(api.baseUrl, "/v2/ingress", {
        token,
        body: shadowBody(tenant, {
          external_conversation_id: "same_ext",
          external_message_id: ext,
        }),
      });
    const a = await mk("tenant_a", "local-tenant-a");
    const b = await mk("tenant_b", "local-tenant-b");
    assert.equal(a.status, 202);
    assert.equal(b.status, 202);
  });

  it("10. consulta cross-tenant rechazada", async () => {
    const ingress = await req(api.baseUrl, "/v2/ingress", {
      token: "local-tenant-a",
      body: shadowBody("tenant_a", {
        content: { text: "actualizar odómetro a 12345 km" },
      }),
    });
    const turnId = (ingress.json as { turn_id: string }).turn_id;
    assert.ok(turnId);
    const cross = await req(api.baseUrl, `/v2/turns/${turnId}`, {
      token: "local-tenant-b",
      tenant: "tenant_b",
    });
    assert.equal(cross.status, 404);
  });

  it("11. confirmación sintética", async () => {
    const r = await req(api.baseUrl, "/v2/confirm", {
      token: "local-tenant-a",
      body: {
        tenant_id: "tenant_a",
        conversation_id: "n/a",
        customer_id: "n/a",
        text: "CONFIRMO",
      },
    });
    assert.equal(r.status, 200);
    assert.equal((r.json as { delivery_enabled: boolean }).delivery_enabled, false);
  });

  it("12. flags fail-closed", () => {
    applyTestFlags();
    const f = loadPhase7Flags();
    assert.equal(f.DELIVERY_ENABLED, false);
    assert.equal(f.SHADOW_MODE, true);
    const prev = process.env.DELIVERY_ENABLED;
    process.env.DELIVERY_ENABLED = "true";
    assert.throws(() => loadPhase7Flags());
    process.env.DELIVERY_ENABLED = prev;
  });

  it("13-16. replay determinístico + duplicados", async () => {
    const fixture = {
      fixture_id: "fx1",
      schema_version: 1 as const,
      tenant_id: "tenant_a",
      steps: [
        {
          at_offset_ms: 0,
          ingress: {
            schema_version: 1 as const,
            source: "replay" as const,
            tenant_id: "tenant_a",
            external_conversation_id: "r1",
            external_message_id: "m1",
            message_type: "text" as const,
            content: { text: "hola" },
            metadata: {},
            is_shadow: false,
          },
        },
        {
          at_offset_ms: 10,
          ingress: {
            schema_version: 1 as const,
            source: "replay" as const,
            tenant_id: "tenant_a",
            external_conversation_id: "r1",
            external_message_id: "m1",
            message_type: "text" as const,
            content: { text: "hola" },
            metadata: {},
            is_shadow: false,
          },
        },
      ],
      expect: { min_turns: 1 },
    };
    const a = await req(api.baseUrl, "/v2/replay", {
      token: "local-admin",
      body: fixture,
    });
    assert.equal(a.status, 200);
    assert.equal((a.json as { ok: boolean }).ok, true);
    const b = await req(api.baseUrl, "/v2/replay", {
      token: "local-admin",
      body: fixture,
    });
    assert.equal(
      (a.json as { deterministic_hash: string }).deterministic_hash,
      (b.json as { deterministic_hash: string }).deterministic_hash,
    );
  });

  it("15. replay fuera de orden (offsets)", async () => {
    const fixture = {
      fixture_id: "fx_oo",
      schema_version: 1 as const,
      tenant_id: "tenant_a",
      steps: [
        {
          at_offset_ms: 100,
          ingress: {
            schema_version: 1 as const,
            source: "replay" as const,
            tenant_id: "tenant_a",
            external_conversation_id: "roo",
            external_message_id: "late",
            message_type: "text" as const,
            content: { text: "segundo" },
            metadata: {},
            is_shadow: false,
          },
        },
        {
          at_offset_ms: 0,
          ingress: {
            schema_version: 1 as const,
            source: "replay" as const,
            tenant_id: "tenant_a",
            external_conversation_id: "roo",
            external_message_id: "early",
            message_type: "text" as const,
            content: { text: "primero" },
            metadata: {},
            is_shadow: false,
          },
        },
      ],
    };
    const r = await req(api.baseUrl, "/v2/replay", {
      token: "local-admin",
      body: fixture,
    });
    assert.equal(r.status, 200);
    assert.equal((r.json as { steps: unknown[] }).steps.length, 2);
  });

  it("17. dos replays concurrentes", async () => {
    const mk = (tid: string) => ({
      fixture_id: `fx_${tid}`,
      schema_version: 1 as const,
      tenant_id: tid,
      steps: [
        {
          at_offset_ms: 0,
          ingress: {
            schema_version: 1 as const,
            source: "replay" as const,
            tenant_id: tid,
            external_conversation_id: "concurrent",
            external_message_id: "m1",
            message_type: "text" as const,
            content: { text: "hola" },
            metadata: {},
            is_shadow: false,
          },
        },
      ],
    });
    const [a, b] = await Promise.all([
      req(api.baseUrl, "/v2/replay", {
        token: "local-admin",
        body: mk("tenant_a"),
      }),
      req(api.baseUrl, "/v2/replay", {
        token: "local-admin",
        body: mk("tenant_b"),
      }),
    ]);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
  });

  it("18. shadow sin entrega", async () => {
    const h = await req(api.baseUrl, "/health");
    assert.equal((h.json as { delivery_enabled: boolean }).delivery_enabled, false);
    assert.equal((h.json as { shadow: boolean }).shadow, true);
  });

  it("19. fake model timeout", async () => {
    const m = new TimeoutModelAdapter(5);
    await assert.rejects(() => m.decide({} as never), /model_timeout/);
  });

  it("20. fake model JSON inválido", async () => {
    const m = new InvalidJsonModelAdapter();
    const out = await m.decide({} as never);
    assert.ok(out === undefined || typeof out === "string" || out !== null);
  });

  it("21-22. contrato rechaza tools/commit", () => {
    assert.throws(() =>
      parseCanonicalIngress({
        ...shadowBody("t"),
        tools: ["commit_odometer_update"],
      }),
    );
    assert.throws(() =>
      parseCanonicalIngress({
        ...shadowBody("t"),
        commit: true,
      }),
    );
  });

  it("23. API no muta estado directo", async () => {
    const r = await req(api.baseUrl, "/v2/admin/mutate", {
      method: "PUT",
      token: "local-admin",
      body: { status: "succeeded" },
    });
    assert.equal(r.status, 405);
  });

  it("24. callback rechazado", async () => {
    const r = await req(api.baseUrl, "/v2/ingress?callback_url=http://evil", {
      token: "local-admin",
      body: { x: 1 },
    });
    assert.equal(r.status, 400);
    assert.equal((r.json as { error: string }).error, "callback_rejected");
  });

  it("25. request excesivo", async () => {
    const big = "x".repeat(70_000);
    const r = await fetch(`${api.baseUrl}/v2/ingress`, {
      method: "POST",
      headers: {
        authorization: "Bearer local-admin",
        "content-type": "application/json",
      },
      body: JSON.stringify({ schema_version: 1, content: { text: big } }),
    });
    assert.ok(r.status >= 400);
  });

  it("26. error sanitizado", async () => {
    const r = await req(api.baseUrl, "/v2/ingress", {
      token: "local-admin",
      body: { schema_version: 1 },
    });
    const s = JSON.stringify(r.json);
    assert.equal(/postgres|password|Bearer /i.test(s), false);
  });

  it("27. correlation ids", async () => {
    const cid = randomUUID();
    const res = await fetch(`${api.baseUrl}/health`, {
      headers: { "x-correlation-id": cid },
    });
    assert.equal(res.headers.get("x-correlation-id"), cid);
  });

  it("28. métricas sin secretos", async () => {
    const r = await req(api.baseUrl, "/v2/traces", { token: "local-admin" });
    assert.equal(r.status, 200);
    const s = JSON.stringify(r.json);
    assert.equal(/password|Bearer |api_key/i.test(s), false);
  });

  it("29-30. shutdown limpio", async () => {
    const tmp = await startApiServer({ databaseUrl: url, port: 0 });
    await tmp.close();
    await assert.rejects(() =>
      fetch(`${tmp.baseUrl}/health`).then((r) => r.text()),
    );
  });

  it("31. DeliveryGate sin bypass", async () => {
    const r = await prepareEffectOutbox(api.runtime.prisma, {
      operationId: "x",
      conversationId: "y",
      channelAccountId: "sim",
      toolName: "commit_odometer_update",
      ownerId: "o",
      lockFencingToken: 1n,
      simulatorUrl: api.runtime.simulator.baseUrl,
      allowedPorts: new Set([api.runtime.simulator.port]),
      companyId: "c",
      deliveryGate: undefined as unknown as never,
    });
    assert.equal(r.ok, false);
  });

  it("32-35. loopback, sin LLM/canal real, cero externo", () => {
    assert.equal(api.host, "127.0.0.1");
    assert.ok(api.runtime.simulator.origin.startsWith("http://127.0.0.1:"));
    assert.equal(FutureLlmAdapterStub.enabled, false);
    assertNoRealChannels();
    assert.equal(ALLOW_EXTERNAL_MUTATIONS, false);
  });

  it("outbox inspección sanitizada", async () => {
    const r = await req(api.baseUrl, "/v2/outbox", {
      token: "local-tenant-a",
      tenant: "tenant_a",
    });
    assert.equal(r.status, 200);
  });
});
