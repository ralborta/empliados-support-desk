/**
 * Simulador HTTP local configurable (solo 127.0.0.1).
 * Escenarios vía header X-Sim-Scenario. Sin secrets.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";

export type SimScenario =
  | "success"
  | "permanent"
  | "retryable"
  | "timeout_before_send"
  | "timeout_after_send"
  | "reset_after_write"
  | "malformed_after_process"
  | "duplicate";

export type LocalSimulator = {
  port: number;
  origin: string;
  baseUrl: string;
  close: () => Promise<void>;
  applied: Map<string, { at: string; body: unknown }>;
  get requestCount(): number;
};

export async function startLocalSimulator(opts?: {
  host?: string;
}): Promise<LocalSimulator> {
  const host = opts?.host ?? "127.0.0.1";
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error("simulator_host_must_be_loopback");
  }

  const applied = new Map<string, { at: string; body: unknown }>();
  let requestCount = 0;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${host}`);

    if (url.pathname === "/health") {
      res.writeHead(200);
      res.end("ok");
      return;
    }

    if (url.pathname === "/reconcile" && req.method === "GET") {
      const key = url.searchParams.get("idempotencyKey") || "";
      const hit = applied.get(key);
      if (!hit) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "absent" }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "applied", ...hit }));
      return;
    }

    if (url.pathname !== "/effect" || req.method !== "POST") {
      res.writeHead(404);
      res.end("not_found");
      return;
    }

    requestCount += 1;
    const scenario = (req.headers["x-sim-scenario"] as SimScenario) || "success";
    const idem =
      (req.headers["idempotency-key"] as string) ||
      (req.headers["x-idempotency-key"] as string) ||
      "";

    if (scenario === "timeout_before_send") {
      return; // never read/respond
    }

    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(chunk as Buffer);
    }
    let body: unknown = {};
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    } catch {
      body = {};
    }

    if (scenario === "reset_after_write") {
      applied.set(idem || `anon-${requestCount}`, {
        at: new Date().toISOString(),
        body,
      });
      req.socket.destroy();
      return;
    }
    if (scenario === "timeout_after_send") {
      applied.set(idem || `anon-${requestCount}`, {
        at: new Date().toISOString(),
        body,
      });
      return;
    }
    if (scenario === "malformed_after_process") {
      applied.set(idem || `anon-${requestCount}`, {
        at: new Date().toISOString(),
        body,
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("{not-json");
      return;
    }
    if (scenario === "duplicate" || (idem && applied.has(idem))) {
      if (idem && !applied.has(idem)) {
        applied.set(idem, { at: new Date().toISOString(), body });
      }
      res.writeHead(409, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "duplicate", idempotencyKey: idem }));
      return;
    }
    if (scenario === "permanent") {
      res.writeHead(422, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "rejected", code: "PERMANENT" }));
      return;
    }
    if (scenario === "retryable") {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "unavailable", code: "RETRYABLE" }));
      return;
    }

    if (idem) {
      applied.set(idem, { at: new Date().toISOString(), body });
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: "ok",
        externalId: `sim_${(idem || String(requestCount)).slice(0, 12)}`,
        applied: true,
      }),
    );
  });

  await new Promise<void>((resolve) => {
    server.listen(0, host, () => resolve());
  });
  const addr = server.address() as AddressInfo;

  return {
    port: addr.port,
    origin: `http://${host}:${addr.port}`,
    baseUrl: `http://${host}:${addr.port}/effect`,
    applied,
    get requestCount() {
      return requestCount;
    },
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
