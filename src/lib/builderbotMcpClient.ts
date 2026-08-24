/**
 * Cliente liviano del MCP HTTP de BuilderBot Cloud (SSE + messages).
 * Usado por el monitor BBC para status/reboot del runtime Meta — no es la API v2 de mensajes.
 *
 * Env:
 *   BUILDERBOT_MCP_API_KEY  (clave bbc-… del MCP; distinta de BUILDERBOT_API_KEY bb-…)
 *   BUILDERBOT_MCP_SSE_URL  (default https://bbc-mcp-http.builderbot.cloud/mcp/builderbot/sse)
 */

const DEFAULT_SSE_URL = "https://bbc-mcp-http.builderbot.cloud/mcp/builderbot/sse";

type JsonRpcMessage = {
  jsonrpc?: string;
  id?: number | string;
  method?: string;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
  params?: unknown;
};

export type BuilderBotDeployStatusProbe = {
  ok: boolean;
  status: string | null;
  message: string;
  raw?: unknown;
  configError?: boolean;
};

export type BuilderBotDeployActionResult = {
  ok: boolean;
  message: string;
  raw?: unknown;
};

function mcpApiKey(): string {
  return (
    process.env.BUILDERBOT_MCP_API_KEY?.trim() ||
    process.env.BUILDERBOT_MCP_KEY?.trim() ||
    ""
  );
}

function sseUrl(): string {
  return (
    process.env.BUILDERBOT_MCP_SSE_URL?.trim() ||
    DEFAULT_SSE_URL
  ).replace(/\/$/, "");
}

function originFromSse(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "https://bbc-mcp-http.builderbot.cloud";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Abre SSE, obtiene session endpoint, llama tools/call y espera el result por SSE.
 */
export async function callBuilderBotMcpTool(
  toolName: string,
  args: Record<string, unknown>,
  opts?: { timeoutMs?: number },
): Promise<{ ok: boolean; result: unknown; message: string }> {
  const apiKey = mcpApiKey();
  if (!apiKey) {
    return {
      ok: false,
      result: null,
      message: "Falta BUILDERBOT_MCP_API_KEY (clave bbc- del MCP)",
    };
  }

  const timeoutMs = opts?.timeoutMs ?? 25_000;
  const sse = sseUrl();
  const origin = originFromSse(sse);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const sseRes = await fetch(sse, {
      method: "GET",
      headers: {
        Accept: "text/event-stream",
        "x-builderbot-api-key": apiKey,
      },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!sseRes.ok || !sseRes.body) {
      return {
        ok: false,
        result: null,
        message: `MCP SSE HTTP ${sseRes.status}`,
      };
    }

    const reader = sseRes.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let messageUrl: string | null = null;
    let initDone = false;
    let callId = 2;
    let toolResult: unknown = null;
    let toolError: string | null = null;
    let pendingEvent: string | null = null;
    let pendingData: string[] = [];

    const postJson = async (payload: Record<string, unknown>): Promise<number> => {
      if (!messageUrl) throw new Error("MCP message URL no listo");
      const res = await fetch(messageUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          "x-builderbot-api-key": apiKey,
        },
        body: JSON.stringify(payload),
        cache: "no-store",
        signal: controller.signal,
      });
      // 202 Accepted es normal en este transporte
      if (!res.ok && res.status !== 202) {
        const text = await res.text().catch(() => "");
        throw new Error(`MCP messages HTTP ${res.status}: ${text.slice(0, 200)}`);
      }
      return res.status;
    };

    const handleSseData = async (eventName: string | null, data: string) => {
      if (eventName === "endpoint" || (!eventName && data.startsWith("/"))) {
        messageUrl = data.startsWith("http") ? data : `${origin}${data}`;
        if (!initDone) {
          initDone = true;
          await postJson({
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: {
              protocolVersion: "2024-11-05",
              capabilities: {},
              clientInfo: { name: "wara-bbc-monitor", version: "1.0" },
            },
          });
          await postJson({ jsonrpc: "2.0", method: "notifications/initialized" });
          await postJson({
            jsonrpc: "2.0",
            id: callId,
            method: "tools/call",
            params: { name: toolName, arguments: args },
          });
        }
        return;
      }

      let parsed: JsonRpcMessage | null = null;
      try {
        parsed = JSON.parse(data) as JsonRpcMessage;
      } catch {
        return;
      }
      if (parsed.id === callId) {
        if (parsed.error) {
          toolError =
            typeof parsed.error.message === "string"
              ? parsed.error.message
              : "MCP tools/call error";
        } else {
          toolResult = parsed.result ?? null;
        }
      }
    };

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline && toolResult == null && toolError == null) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const rawLine = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        const line = rawLine.replace(/\r$/, "");
        if (line.startsWith("event:")) {
          pendingEvent = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          pendingData.push(line.slice(5).replace(/^\s/, ""));
        } else if (line === "") {
          if (pendingData.length) {
            const data = pendingData.join("\n");
            const ev = pendingEvent;
            pendingEvent = null;
            pendingData = [];
            await handleSseData(ev, data);
          } else {
            pendingEvent = null;
          }
        }
      }
      if (toolResult != null || toolError != null) break;
      await sleep(0);
    }

    try {
      await reader.cancel();
    } catch {
      /* ignore */
    }

    if (toolError) {
      return { ok: false, result: null, message: toolError };
    }
    if (toolResult == null) {
      return {
        ok: false,
        result: null,
        message: messageUrl
          ? "Timeout esperando resultado MCP"
          : "No se recibió endpoint SSE del MCP",
      };
    }
    return { ok: true, result: toolResult, message: "ok" };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, result: null, message: `MCP falló: ${detail}` };
  } finally {
    clearTimeout(timer);
  }
}

function extractToolText(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) return null;
  for (const part of content) {
    if (
      part &&
      typeof part === "object" &&
      (part as { type?: string }).type === "text" &&
      typeof (part as { text?: string }).text === "string"
    ) {
      return (part as { text: string }).text;
    }
  }
  return null;
}

function parseToolJson(result: unknown): unknown {
  const text = extractToolText(result);
  if (!text) return result;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { text };
  }
}

function readStatusString(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as Record<string, unknown>;
  const nested = root.status;
  if (typeof nested === "string") return nested;
  if (nested && typeof nested === "object") {
    const s = (nested as Record<string, unknown>).status;
    if (typeof s === "string") return s;
  }
  return null;
}

export async function probeBuilderBotDeployStatus(
  projectId: string,
): Promise<BuilderBotDeployStatusProbe> {
  if (!mcpApiKey()) {
    return {
      ok: false,
      status: null,
      message: "Falta BUILDERBOT_MCP_API_KEY",
      configError: true,
    };
  }
  const call = await callBuilderBotMcpTool("builderbot_deploy", {
    projectId,
    action: "status",
  });
  if (!call.ok) {
    return {
      ok: false,
      status: null,
      message: call.message,
      configError: /Falta BUILDERBOT_MCP|401|403|credencial/i.test(call.message),
    };
  }
  const parsed = parseToolJson(call.result);
  const status = readStatusString(parsed);
  if (!status) {
    return {
      ok: false,
      status: null,
      message: "MCP status sin campo status",
      raw: parsed,
    };
  }
  const healthy =
    /^(ONLINE|CONNECTED)$/i.test(status.trim()) ||
    (/READY$/i.test(status.trim()) && !/READY_TO_SCAN/i.test(status.trim()));
  return {
    ok: healthy,
    status: status.trim().toUpperCase(),
    message: `Deploy status: ${status.trim().toUpperCase()}`,
    raw: parsed,
  };
}

export async function rebootBuilderBotDeploy(
  projectId: string,
): Promise<BuilderBotDeployActionResult> {
  if (!mcpApiKey()) {
    return {
      ok: false,
      message: "Falta BUILDERBOT_MCP_API_KEY — no se puede hacer reboot",
    };
  }
  const call = await callBuilderBotMcpTool("builderbot_deploy", {
    projectId,
    action: "reboot",
  });
  if (!call.ok) {
    return { ok: false, message: call.message };
  }
  const parsed = parseToolJson(call.result);
  return {
    ok: true,
    message: "Reboot solicitado vía MCP",
    raw: parsed,
  };
}
