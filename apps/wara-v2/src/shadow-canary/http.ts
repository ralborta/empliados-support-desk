/**
 * HTTP loopback mínimo solo para shadow-canary 10A.
 * No DeliveryGate, no ingress TurnPipeline.
 */
import http from "node:http";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { loadShadowCanaryConfig } from "./flags.js";
import { processShadowCanaryCopy } from "./enqueue.js";

export type ShadowCanaryServer = {
  port: number;
  host: string;
  baseUrl: string;
  close: () => Promise<void>;
};

export async function startShadowCanaryServer(opts?: {
  host?: string;
  port?: number;
}): Promise<ShadowCanaryServer> {
  const host = opts?.host ?? process.env.WARA_V2_BIND_HOST ?? "127.0.0.1";
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error(`bind_host_not_loopback:${host}`);
  }
  // Validar config al arrancar si se intenta habilitar
  const cfg = loadShadowCanaryConfig();
  if (cfg.enabled === false && cfg.reason === "shadow_off") {
    // Permitir arrancar apagado (health only) — fail-closed en process
  }

  const server = http.createServer(async (req, res) => {
    const correlationId =
      (req.headers["x-correlation-id"] as string) || "shadow";
    const respond = (status: number, body: unknown) => {
      res.writeHead(status, {
        "content-type": "application/json",
        "x-correlation-id": correlationId,
        "cache-control": "no-store",
      });
      res.end(JSON.stringify(body));
    };
    try {
      const url = new URL(req.url ?? "/", `http://${host}`);
      if (req.method === "GET" && url.pathname === "/health") {
        const c = loadShadowCanaryConfig();
        respond(200, {
          status: "ok",
          phase: "10A",
          shadow_enabled: c.enabled,
          delivery_enabled: false,
        });
        return;
      }
      if (req.method === "POST" && url.pathname === "/v2/shadow-canary") {
        const chunks: Buffer[] = [];
        for await (const c of req) {
          chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
          if (Buffer.concat(chunks).length > 64 * 1024) {
            respond(413, { error: "payload_too_large" });
            return;
          }
        }
        const raw = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
          phone_e164: string;
          tenant_id: string;
          text: string;
          message_id: string;
          has_attachment?: boolean;
          v1_outcome_sanitized?: Record<string, unknown>;
        };
        const result = await processShadowCanaryCopy({
          phone_e164: raw.phone_e164,
          tenant_id: raw.tenant_id,
          text: raw.text,
          message_id: raw.message_id,
          has_attachment: raw.has_attachment,
          v1_outcome_sanitized: raw.v1_outcome_sanitized,
        });
        respond(result.accepted ? 202 : 200, {
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
      respond(404, { error: "not_found" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "error";
      respond(400, { error: msg.slice(0, 120) });
    }
  });

  const port = opts?.port ?? Number(process.env.WARA_V2_SHADOW_PORT ?? "8787");
  await new Promise<void>((resolve, reject) => {
    server.listen(port, host, () => resolve());
    server.on("error", reject);
  });
  const addr = server.address();
  const bound =
    typeof addr === "object" && addr ? addr.port : port;

  return {
    port: bound,
    host,
    baseUrl: `http://${host}:${bound}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

async function main() {
  const s = await startShadowCanaryServer();
  console.log(
    JSON.stringify({
      shadow_canary: true,
      baseUrl: s.baseUrl,
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
