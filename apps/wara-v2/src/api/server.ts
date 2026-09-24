/**
 * API HTTP V2 local — solo loopback. Sin escritura directa de estados.
 */
import http from "node:http";
import { randomUUID } from "node:crypto";
import {
  parseCanonicalIngress,
  CANONICAL_INGRESS_SCHEMA_VERSION,
} from "@wara-v2/contracts";
import { createV2Runtime, type V2Runtime } from "../runtime/compose.js";
import { loadPhase7Flags, applyTestFlags, type Phase7Flags } from "./flags.js";
import { authenticate, authorize } from "./auth.js";
import { LocalObserver } from "./observe.js";
import { processShadowIngress } from "./shadow.js";
import { runReplay, fixedClock, type ReplayFixture } from "./replay.js";
import { assertNoRealModel } from "./model-adapters.js";
import { assertNoRealChannels } from "./channel-adapters.js";

const MAX_BODY = 64 * 1024;
const RATE_WINDOW_MS = 1000;
const RATE_MAX = 30;

export type ApiServer = {
  port: number;
  host: string;
  runtime: V2Runtime;
  observer: LocalObserver;
  close: () => Promise<void>;
  baseUrl: string;
};

type Ctx = {
  runtime: V2Runtime;
  flags: Phase7Flags;
  observer: LocalObserver;
  rate: Map<string, { n: number; t: number }>;
  shuttingDown: { value: boolean };
};

function json(
  res: http.ServerResponse,
  status: number,
  body: unknown,
  correlationId: string,
) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "x-correlation-id": correlationId,
    "cache-control": "no-store",
  });
  res.end(payload);
}

function sanitizeError(err: unknown): { code: string; message: string } {
  const msg = err instanceof Error ? err.message : "error";
  const code = msg.split(":")[0] ?? "error";
  // Nunca DSN, tokens, payloads
  if (/postgres|password|token|dsn|Bearer/i.test(msg)) {
    return { code: "internal_error", message: "sanitized" };
  }
  return { code, message: msg.slice(0, 200) };
}

async function readBody(req: http.IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > MAX_BODY) throw new Error("payload_too_large");
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

function rateLimit(ctx: Ctx, key: string): boolean {
  const now = Date.now();
  const cur = ctx.rate.get(key);
  if (!cur || now - cur.t > RATE_WINDOW_MS) {
    ctx.rate.set(key, { n: 1, t: now });
    return true;
  }
  cur.n += 1;
  return cur.n <= RATE_MAX;
}

async function handle(
  ctx: Ctx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
) {
  const correlationId =
    (req.headers["x-correlation-id"] as string) || randomUUID();
  const started = Date.now();

  try {
    if (ctx.shuttingDown.value) {
      json(res, 503, { error: "shutting_down" }, correlationId);
      return;
    }

    const host = req.headers.host ?? "";
    if (host && !host.startsWith("127.0.0.1") && !host.startsWith("localhost")) {
      json(res, 403, { error: "host_not_allowed" }, correlationId);
      return;
    }

    const url = new URL(req.url ?? "/", `http://${ctx.flags.BIND_HOST}`);
    const path = url.pathname;
    const method = req.method ?? "GET";

    // Callbacks / URLs arbitrarias — fail-closed antes de cualquier handler
    if (path.includes("callback") || url.searchParams.has("callback_url")) {
      json(res, 400, { error: "callback_rejected" }, correlationId);
      return;
    }

    if (!rateLimit(ctx, `${req.socket.remoteAddress}|${path}`)) {
      json(res, 429, { error: "rate_limited" }, correlationId);
      return;
    }

    // Health sin auth
    if (method === "GET" && path === "/health") {
      json(
        res,
        200,
        {
          status: "ok",
          phase: 7,
          shadow: ctx.flags.SHADOW_MODE,
          delivery_enabled: ctx.flags.DELIVERY_ENABLED,
        },
        correlationId,
      );
      return;
    }
    if (method === "GET" && path === "/ready") {
      await ctx.runtime.prisma.$queryRawUnsafe("SELECT 1");
      json(res, 200, { ready: true }, correlationId);
      return;
    }

    const principal = authenticate(req.headers.authorization);
    if (!principal) {
      json(res, 401, { error: "unauthorized" }, correlationId);
      return;
    }

    const tenantHeader = (req.headers["x-tenant-id"] as string) || "";
    if (path !== "/health" && path !== "/ready" && !tenantHeader && principal.tenantId !== "*") {
      // admin puede omitir en algunos endpoints de métricas
    }

    // --- routes ---
    if (method === "POST" && path === "/v2/ingress") {
      const authz = authorize(principal, "ingress:write");
      if (!authz.ok) {
        json(res, 403, { error: authz.code }, correlationId);
        return;
      }
      const ct = req.headers["content-type"] ?? "";
      if (!ct.includes("application/json")) {
        json(res, 415, { error: "unsupported_media_type" }, correlationId);
        return;
      }
      const rawBuf = await readBody(req);
      const raw = JSON.parse(rawBuf.toString("utf8"));
      const ingress = parseCanonicalIngress(raw);
      if (principal.tenantId !== "*" && principal.tenantId !== ingress.tenant_id) {
        json(res, 403, { error: "forbidden_tenant" }, correlationId);
        return;
      }
      if (ingress.is_shadow || ctx.flags.SHADOW_MODE) {
        const shadow = await processShadowIngress(
          ctx.runtime,
          ctx.flags,
          ctx.observer,
          {
            tenantId: ingress.tenant_id,
            text: ingress.content.text,
            externalMessageId: ingress.external_message_id,
            correlationId: ingress.correlation_id || correlationId,
          },
        );
        ctx.observer.emit({
          at: new Date().toISOString(),
          event: "api_ingress_shadow",
          tenant_id: ingress.tenant_id,
          correlation_id: correlationId,
          duration_ms: Date.now() - started,
          refs: { turn_id: shadow.turn_id ?? "" },
        });
        json(res, 202, shadow, correlationId);
        return;
      }
      json(res, 400, { error: "non_shadow_ingress_disabled" }, correlationId);
      return;
    }

    if (method === "GET" && path.startsWith("/v2/turns/")) {
      const authz = authorize(principal, "turn:read");
      if (!authz.ok) {
        json(res, 403, { error: authz.code }, correlationId);
        return;
      }
      const turnId = path.slice("/v2/turns/".length);
      const turn = await ctx.runtime.prisma.turn.findUnique({
        where: { id: turnId },
      });
      if (!turn) {
        json(res, 404, { error: "not_found" }, correlationId);
        return;
      }
      const conv = await ctx.runtime.prisma.conversation.findUnique({
        where: { id: turn.conversationId },
      });
      const tenant = conv?.activeCompanyId ?? "";
      const tAuth = authorize(principal, "turn:read", tenant);
      if (!tAuth.ok) {
        json(res, 404, { error: "not_found" }, correlationId); // no leak
        return;
      }
      json(
        res,
        200,
        {
          id: turn.id,
          outcome: turn.outcome,
          mode: turn.mode,
          tenant_id: tenant,
        },
        correlationId,
      );
      return;
    }

    if (method === "GET" && path.startsWith("/v2/operations/")) {
      const authz = authorize(principal, "operation:read");
      if (!authz.ok) {
        json(res, 403, { error: authz.code }, correlationId);
        return;
      }
      const opId = path.slice("/v2/operations/".length);
      const op = await ctx.runtime.prisma.operation.findUnique({
        where: { id: opId },
      });
      if (!op) {
        json(res, 404, { error: "not_found" }, correlationId);
        return;
      }
      const tAuth = authorize(principal, "operation:read", op.companyId);
      if (!tAuth.ok) {
        json(res, 404, { error: "not_found" }, correlationId);
        return;
      }
      json(
        res,
        200,
        {
          id: op.id,
          status: op.status,
          tenant_id: op.companyId,
          attempt_count: op.attemptCount,
          version: op.operationVersion,
        },
        correlationId,
      );
      return;
    }

    if (method === "POST" && path === "/v2/confirm") {
      const authz = authorize(principal, "confirm:write");
      if (!authz.ok) {
        json(res, 403, { error: authz.code }, correlationId);
        return;
      }
      const body = JSON.parse((await readBody(req)).toString("utf8")) as {
        tenant_id: string;
        conversation_id: string;
        customer_id: string;
        text?: string;
      };
      if (principal.tenantId !== "*" && principal.tenantId !== body.tenant_id) {
        json(res, 403, { error: "forbidden_tenant" }, correlationId);
        return;
      }
      const result = await processShadowIngress(
        ctx.runtime,
        ctx.flags,
        ctx.observer,
        {
          tenantId: body.tenant_id,
          text: body.text ?? "CONFIRMO",
          externalMessageId: randomUUID(),
          correlationId,
        },
      );
      json(res, 200, result, correlationId);
      return;
    }

    if (method === "POST" && path === "/v2/workers/outbox/run") {
      const authz = authorize(principal, "worker:run");
      if (!authz.ok) {
        json(res, 403, { error: authz.code }, correlationId);
        return;
      }
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}") as {
        outbox_id?: string;
        scenario?: string;
      };
      const result = await ctx.runtime.dispatchOutboxOnce(
        body.outbox_id,
        body.scenario ?? "success",
      );
      json(res, 200, { result }, correlationId);
      return;
    }

    if (method === "POST" && path === "/v2/workers/reconcile/run") {
      const authz = authorize(principal, "reconcile:run");
      if (!authz.ok) {
        json(res, 403, { error: authz.code }, correlationId);
        return;
      }
      const body = JSON.parse((await readBody(req)).toString("utf8")) as {
        operation_id: string;
      };
      const op = await ctx.runtime.prisma.operation.findUnique({
        where: { id: body.operation_id },
      });
      if (!op) {
        json(res, 404, { error: "not_found" }, correlationId);
        return;
      }
      const tAuth = authorize(principal, "reconcile:run", op.companyId);
      if (!tAuth.ok) {
        json(res, 404, { error: "not_found" }, correlationId);
        return;
      }
      const result = await ctx.runtime.reconcileOnce(body.operation_id);
      json(res, 200, { result }, correlationId);
      return;
    }

    if (method === "GET" && path === "/v2/traces") {
      const authz = authorize(principal, "trace:read");
      if (!authz.ok) {
        json(res, 403, { error: authz.code }, correlationId);
        return;
      }
      json(res, 200, ctx.observer.snapshot(), correlationId);
      return;
    }

    if (method === "GET" && path === "/v2/outbox") {
      const authz = authorize(principal, "outbox:read");
      if (!authz.ok) {
        json(res, 403, { error: authz.code }, correlationId);
        return;
      }
      const tenant = tenantHeader || (principal.tenantId !== "*" ? principal.tenantId : "");
      const rows = await ctx.runtime.prisma.deliveryOutbox.findMany({
        where: tenant
          ? { conversation: { activeCompanyId: tenant } }
          : undefined,
        take: 50,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          status: true,
          kind: true,
          attemptCount: true,
          destinationKey: true,
          lastClassification: true,
          operationId: true,
        },
      });
      json(res, 200, { items: rows }, correlationId);
      return;
    }

    if (method === "POST" && path === "/v2/replay") {
      const authz = authorize(principal, "replay:run");
      if (!authz.ok) {
        json(res, 403, { error: authz.code }, correlationId);
        return;
      }
      const fixture = JSON.parse(
        (await readBody(req)).toString("utf8"),
      ) as ReplayFixture;
      if (principal.tenantId !== "*" && principal.tenantId !== fixture.tenant_id) {
        json(res, 403, { error: "forbidden_tenant" }, correlationId);
        return;
      }
      // Solo bases descartables: exige WARA_V2_DATABASE_URL local (embedded harness)
      const dbUrl = process.env.WARA_V2_DATABASE_URL ?? "";
      if (/railway|vercel|prod|easypanel/i.test(dbUrl)) {
        json(res, 403, { error: "replay_base_not_discardable" }, correlationId);
        return;
      }
      const clock = fixedClock(new Date("2026-01-01T00:00:00.000Z"));
      const report = await runReplay(ctx.runtime, fixture, clock);
      json(res, 200, report, correlationId);
      return;
    }

    // Rechazar escritura directa de estado
    if (
      method === "PUT" ||
      method === "PATCH" ||
      path.includes("/admin/mutate") ||
      path.includes("/direct-state")
    ) {
      json(res, 405, { error: "direct_state_mutation_forbidden" }, correlationId);
      return;
    }

    json(res, 404, { error: "not_found" }, correlationId);
  } catch (err) {
    const s = sanitizeError(err);
    ctx.observer.emit({
      at: new Date().toISOString(),
      event: "api_error",
      tenant_id: "unknown",
      correlation_id: correlationId,
      reason_code: s.code,
      duration_ms: Date.now() - started,
    });
    json(res, 400, { error: s.code, message: s.message }, correlationId);
  }
}

export async function startApiServer(opts?: {
  port?: number;
  databaseUrl?: string;
}): Promise<ApiServer> {
  applyTestFlags();
  const flags = loadPhase7Flags();
  assertNoRealModel();
  assertNoRealChannels();

  const runtime = await createV2Runtime({
    databaseUrl: opts?.databaseUrl ?? process.env.WARA_V2_DATABASE_URL,
  });
  const observer = new LocalObserver();
  const shuttingDown = { value: false };
  const ctx: Ctx = {
    runtime,
    flags,
    observer,
    rate: new Map(),
    shuttingDown,
  };

  const server = http.createServer((req, res) => {
    void handle(ctx, req, res);
  });

  const host = flags.BIND_HOST;
  const port = opts?.port ?? 0;
  await new Promise<void>((resolve, reject) => {
    server.listen(port, host, () => resolve());
    server.on("error", reject);
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("bind_failed");

  return {
    port: addr.port,
    host,
    runtime,
    observer,
    baseUrl: `http://${host}:${addr.port}`,
    async close() {
      shuttingDown.value = true;
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
      await runtime.close();
    },
  };
}

export { CANONICAL_INGRESS_SCHEMA_VERSION };
