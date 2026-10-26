import http from "node:http";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import type { SanitizedCleanHealthConfig } from "../../config/clean-config.js";
import type { ProcessCleanTurnResult } from "../../core/orchestration/process-turn.js";
import { CleanRuntimeError, cleanErrorBody, normalizeCleanRuntimeError, type CleanRuntimeErrorCode } from "../../core/errors/runtime-errors.js";

export type CleanLabTurnInput = Readonly<{ tenantId: string; sessionId: string; messageId: string; message: string; customerName?: string | null; phone?: string | null }>;
export interface CleanLabRuntime { turn(input: CleanLabTurnInput): Promise<ProcessCleanTurnResult & Readonly<{ traceId: string }>>; }
export interface CleanLabTraceReader { get(traceId: string, tenantId: string): Promise<unknown | null>; }
export type CleanLabServerConfig = Readonly<{
  host: "127.0.0.1" | "localhost" | "0.0.0.0"; port: number; apiKey: string;
  allowedTenants: ReadonlySet<string>; requestsPerMinute: number; commit: string | null;
  health: SanitizedCleanHealthConfig; persistence: "configured" | "in_memory" | "unavailable";
  kb: "configured" | "disabled" | "unavailable";
  whatsapp?: Readonly<{ apiKey: string; tenantId: string }>;
}>;
export type CleanLabServer = Readonly<{ host: string; port: number; baseUrl: string; close(): Promise<void> }>;

function authorized(header: string | string[] | undefined, expected: string): boolean {
  const raw = Array.isArray(header) ? header[0] ?? "" : header ?? "";
  const provided = raw.startsWith("Bearer ") ? raw.slice(7) : raw;
  if (!expected || provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}
async function body(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []; let bytes = 0;
  for await (const chunk of req) { const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); bytes += value.length; if (bytes > 32_768) throw new Error("payload_too_large"); chunks.push(value); }
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid_payload");
  return parsed as Record<string, unknown>;
}
function textField(raw: Record<string, unknown>, key: string, max: number): string | null {
  const value = raw[key]; if (typeof value !== "string") return null; const trimmed = value.trim();
  return trimmed && trimmed.length <= max ? trimmed : null;
}
function firstTextField(raw: Record<string, unknown>, keys: readonly string[], max: number): string | null {
  for (const key of keys) { const value = textField(raw, key, max); if (value) return value; }
  return null;
}
function whatsappSessionId(phone: string): string {
  return `whatsapp:${createHash("sha256").update(phone).digest("hex").slice(0, 32)}`;
}
function normalizedPhone(value: string): string | null {
  let digits = ""; for (const character of value) if (character >= "0" && character <= "9") digits += character;
  return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
}

export async function startCleanLabServer(config: CleanLabServerConfig, runtime: CleanLabRuntime, traces: CleanLabTraceReader): Promise<CleanLabServer> {
  if (!config.apiKey || config.allowedTenants.size === 0 || config.requestsPerMinute < 1) throw new Error("INVALID_CLEAN_LAB_CONFIG");
  const counters = new Map<string, { minute: number; count: number }>();
  const server = http.createServer(async (req, res) => {
    const reply = (status: number, value: unknown) => { res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(value)); };
    const requestTraceId = randomUUID();
    const fail = (code: CleanRuntimeErrorCode, traceId = requestTraceId) => { const error = new CleanRuntimeError(code, traceId); reply(error.status, cleanErrorBody(error)); };
    const url = new URL(req.url ?? "/", `http://${config.host}`);
    if (req.method === "GET" && url.pathname === "/api/wara-clean-lab/health") {
      reply(200, { runtime: "clean", enabled: config.health.enabled, externalReadsEnabled: config.health.externalReadsEnabled, externalWritesEnabled: config.health.externalWritesEnabled, deliveryEnabled: config.health.deliveryEnabled, llmEnabled: config.health.llmEnabled, persistence: config.persistence, kb: config.kb, commit: config.commit }); return;
    }
    try {
      if (req.method === "POST" && url.pathname === "/api/wara-clean-lab/turn") {
        if (!authorized(req.headers.authorization ?? req.headers["x-api-key"], config.apiKey)) { fail("UNAUTHENTICATED"); return; }
        const raw = await body(req); const tenantId = textField(raw, "tenantId", 120); const sessionId = textField(raw, "sessionId", 160); const messageId = textField(raw, "messageId", 160); const message = textField(raw, "message", 8_000);
        if (!tenantId || !sessionId || !messageId || !message) { fail("INVALID_REQUEST"); return; }
        if (!config.allowedTenants.has(tenantId)) { fail("TENANT_FORBIDDEN"); return; }
        const minute = Math.floor(Date.now() / 60_000); const key = `${tenantId}\u0000${sessionId}`; const prior = counters.get(key); const count = prior?.minute === minute ? prior.count + 1 : 1; counters.set(key, { minute, count });
        if (count > config.requestsPerMinute) { fail("RATE_LIMITED"); return; }
        if (!config.health.enabled) { fail("RUNTIME_DISABLED"); return; }
        const result = await runtime.turn({ tenantId, sessionId, messageId, message, customerName: textField(raw, "customerName", 80), phone: textField(raw, "phone", 40) });
        reply(200, { reply: result.reply, runtime: "clean", replay: result.replay, decision: result.trace.decision ? { act: result.trace.decision.act, relation: result.trace.decision.relation } : null, authorizedCapabilities: result.trace.authorizedOperationIds, executedCapabilities: result.trace.executionCount, writes: { attempted: result.trace.writeAttempt, executed: result.trace.writeExecuted }, traceId: result.traceId }); return;
      }
      if (req.method === "POST" && url.pathname === "/api/whatsapp/turn") {
        if (!config.whatsapp || !authorized(req.headers.authorization ?? req.headers["x-api-key"], config.whatsapp.apiKey)) { fail("UNAUTHENTICATED"); return; }
        const raw = await body(req); const phone = normalizedPhone(firstTextField(raw, ["phone", "from"], 40) ?? ""); const message = firstTextField(raw, ["body", "rawText", "message"], 8_000);
        if (!phone || !message) { fail("INVALID_REQUEST"); return; }
        const correlationId = Array.isArray(req.headers["x-correlation-id"]) ? req.headers["x-correlation-id"][0] : req.headers["x-correlation-id"];
        const messageId = (firstTextField(raw, ["messageId", "message_id", "id"], 160) ?? (typeof correlationId === "string" && correlationId.trim().length <= 160 ? correlationId.trim() : "")) || randomUUID();
        const sessionId = whatsappSessionId(phone); const minute = Math.floor(Date.now() / 60_000); const key = `${config.whatsapp.tenantId}\u0000${sessionId}`;
        const prior = counters.get(key); const count = prior?.minute === minute ? prior.count + 1 : 1; counters.set(key, { minute, count });
        if (count > config.requestsPerMinute) { fail("RATE_LIMITED"); return; }
        if (!config.health.enabled) { fail("RUNTIME_DISABLED"); return; }
        const result = await runtime.turn({ tenantId: config.whatsapp.tenantId, sessionId, messageId, message, phone, customerName: textField(raw, "customerName", 80) });
        reply(200, { ok: true, ok_s: "true", message: result.reply, summaryText: result.reply, skipResponse_s: "false", flowComplete_s: "true", nextFlow: "", nextFlow_s: "", engine: "wara-clean", replay: result.replay, traceId: result.traceId, writes: { attempted: result.trace.writeAttempt, executed: result.trace.writeExecuted } }); return;
      }
      const prefix = "/api/wara-clean-lab/trace/";
      if (req.method === "GET" && url.pathname.startsWith(prefix)) {
        if (!authorized(req.headers.authorization ?? req.headers["x-api-key"], config.apiKey)) { fail("UNAUTHENTICATED"); return; }
        const traceId = url.pathname.slice(prefix.length); const tenantId = url.searchParams.get("tenantId")?.trim() ?? "";
        if (!traceId || !config.allowedTenants.has(tenantId)) { fail("NOT_FOUND"); return; }
        const trace = await traces.get(traceId, tenantId); if (trace) reply(200, trace); else fail("NOT_FOUND"); return;
      }
      fail("NOT_FOUND");
    } catch (error) {
      const normalized = error instanceof Error && (error.message === "payload_too_large" || error instanceof SyntaxError)
        ? new CleanRuntimeError("INVALID_REQUEST", requestTraceId) : normalizeCleanRuntimeError(error, requestTraceId);
      reply(normalized.status, cleanErrorBody(normalized));
    }
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(config.port, config.host, () => resolve()); });
  const address = server.address(); const port = typeof address === "object" && address ? address.port : config.port;
  return { host: config.host, port, baseUrl: `http://${config.host}:${port}`, close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
}
