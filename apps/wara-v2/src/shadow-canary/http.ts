/**
 * HTTP loopback mínimo solo para shadow-canary 10A + lab chat V2.
 * No DeliveryGate, no ingress TurnPipeline.
 */
import http from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { loadShadowCanaryConfig } from "./flags.js";
import { processShadowCanaryCopy } from "./enqueue.js";
import {
  handlePilotWhatsAppTurn,
  isPilotWhatsAppEnabled,
} from "../pilot/whatsapp-turn.js";
import { isWaraReadConfigured } from "../pilot/wara-client.js";
import { getOdooConfigStatus } from "../pilot/odoo-status.js";
import {
  deletePilotConversationState,
  getPilotConversationState,
  sanitizeStateForLab,
} from "../pilot/conversation-state.js";

export type ShadowCanaryServer = {
  port: number;
  host: string;
  baseUrl: string;
  close: () => Promise<void>;
};

const LAB_CHAT_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../pilot/lab-chat.html",
);

function expectedApiKey(): string {
  return (
    process.env.WARA_V2_TURN_API_KEY?.trim() ||
    process.env.BUILDERBOT_CONTEXT_API_KEY?.trim() ||
    ""
  );
}

function extractApiKey(req: http.IncomingMessage, raw?: Record<string, unknown>): string {
  const headerKey = String(req.headers["x-api-key"] ?? "").trim();
  const auth = String(req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  const bodyKey =
    typeof raw?.api_key === "string"
      ? raw.api_key
      : typeof raw?.apiKey === "string"
        ? raw.apiKey
        : "";
  return headerKey || auth.trim() || bodyKey;
}

function isAuthorized(req: http.IncomingMessage, raw?: Record<string, unknown>): boolean {
  const expected = expectedApiKey();
  if (!expected) return false;
  return extractApiKey(req, raw) === expected;
}

async function readJsonBody(
  req: http.IncomingMessage,
  max = 64 * 1024,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const c of req) {
    chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
    if (Buffer.concat(chunks).length > max) {
      throw new Error("payload_too_large");
    }
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as Record<
    string,
    unknown
  >;
}

function parseMessageId(raw: Record<string, unknown>): string | null {
  const id =
    (typeof raw.messageId === "string" && raw.messageId.trim()) ||
    (typeof raw.message_id === "string" && raw.message_id.trim()) ||
    "";
  return id || null;
}

export async function startShadowCanaryServer(opts?: {
  host?: string;
  port?: number;
}): Promise<ShadowCanaryServer> {
  const host = opts?.host ?? process.env.WARA_V2_BIND_HOST ?? "127.0.0.1";
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "0.0.0.0") {
    throw new Error(`bind_host_not_allowed:${host}`);
  }
  const cfg = loadShadowCanaryConfig();
  if (cfg.enabled === false && cfg.reason === "shadow_off") {
    // Permitir arrancar apagado (health only)
  }

  const server = http.createServer(async (req, res) => {
    const correlationId =
      (req.headers["x-correlation-id"] as string) || "shadow";
    const respondJson = (status: number, body: unknown) => {
      res.writeHead(status, {
        "content-type": "application/json",
        "x-correlation-id": correlationId,
        "cache-control": "no-store",
      });
      res.end(JSON.stringify(body));
    };
    const respondHtml = (status: number, html: string) => {
      res.writeHead(status, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(html);
    };
    try {
      const url = new URL(req.url ?? "/", `http://${host}`);

      if (req.method === "GET" && url.pathname === "/health") {
        respondJson(200, {
          status: "ok",
          phase: "10A",
          shadow_enabled: cfg.enabled,
          delivery_enabled: false,
          pilot_whatsapp: isPilotWhatsAppEnabled(),
          wara_read: isWaraReadConfigured(),
          odoo_configured: getOdooConfigStatus().configured,
          commit: process.env.GIT_COMMIT_SHA?.trim() || null,
          lab_chat: "/lab/chat",
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/lab/chat") {
        respondHtml(200, readFileSync(LAB_CHAT_PATH, "utf8"));
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/pilot/state") {
        if (!isAuthorized(req)) {
          respondJson(401, { error: "unauthorized" });
          return;
        }
        const tenantId =
          url.searchParams.get("tenantId")?.trim() ||
          process.env.WARA_V2_SHADOW_TENANT?.trim() ||
          "tenant_internal_ops";
        const phone = url.searchParams.get("phone")?.trim() || "";
        if (!phone) {
          respondJson(400, { error: "phone_required" });
          return;
        }
        const state = getPilotConversationState(tenantId, phone);
        respondJson(200, { state: sanitizeStateForLab(state) });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/pilot/reset") {
        const raw = await readJsonBody(req);
        if (!isAuthorized(req, raw)) {
          respondJson(401, { error: "unauthorized" });
          return;
        }
        const tenantId =
          (typeof raw.tenantId === "string" && raw.tenantId.trim()) ||
          process.env.WARA_V2_SHADOW_TENANT?.trim() ||
          "tenant_internal_ops";
        const phone = String(raw.phone ?? "").trim();
        if (!phone) {
          respondJson(400, { error: "phone_required" });
          return;
        }
        deletePilotConversationState(tenantId, phone);
        respondJson(200, { ok: true });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/whatsapp/turn") {
        const raw = await readJsonBody(req);
        const messageId = parseMessageId(raw);
        if (!messageId) {
          respondJson(400, {
            error: "messageId_required",
            hint: "Incluí messageId único por mensaje (UUID).",
          });
          return;
        }
        const result = await handlePilotWhatsAppTurn({
          phone: String(raw.phone ?? raw.from ?? ""),
          text: String(raw.body ?? raw.rawText ?? raw.message ?? ""),
          messageId,
          apiKey: extractApiKey(req, raw),
        });
        respondJson(result.status, result.body);
        return;
      }

      if (req.method === "POST" && url.pathname === "/v2/shadow-canary") {
        const raw = await readJsonBody(req);
        const result = await processShadowCanaryCopy({
          phone_e164: String(raw.phone_e164 ?? ""),
          tenant_id: String(raw.tenant_id ?? ""),
          text: String(raw.text ?? ""),
          message_id: String(raw.message_id ?? randomUUID()),
          has_attachment: raw.has_attachment === true,
          v1_outcome_sanitized:
            raw.v1_outcome_sanitized && typeof raw.v1_outcome_sanitized === "object"
              ? (raw.v1_outcome_sanitized as Record<string, unknown>)
              : undefined,
        });
        respondJson(result.accepted ? 202 : 200, {
          accepted: result.accepted,
          reason: result.reason,
          effects: result.record?.effects ?? {
            operations: 0,
            attempts: 0,
            outbox: 0,
            deliveries: 0,
            whatsapp_sends: 0,
          },
        });
        return;
      }

      respondJson(404, { error: "not_found" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "error";
      respondJson(400, { error: msg.slice(0, 120) });
    }
  });

  const port = opts?.port ?? Number(process.env.WARA_V2_SHADOW_PORT ?? "8787");
  await new Promise<void>((resolveListen, reject) => {
    server.listen(port, host, () => resolveListen());
    server.on("error", reject);
  });
  const addr = server.address();
  const bound = typeof addr === "object" && addr ? addr.port : port;

  return {
    port: bound,
    host,
    baseUrl: `http://${host}:${bound}`,
    close: () =>
      new Promise((resolveClose, reject) => {
        server.close((err) => (err ? reject(err) : resolveClose()));
      }),
  };
}

async function main() {
  const s = await startShadowCanaryServer();
  console.log(
    JSON.stringify({
      shadow_canary: true,
      baseUrl: s.baseUrl,
      lab_chat: "/lab/chat",
      note: "evaluation_only; delivery forever false",
    }),
  );
}

const isMain =
  typeof process.argv[1] === "string" &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  void main();
}
