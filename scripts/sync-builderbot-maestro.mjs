#!/usr/bin/env node
/**
 * Push scripts/instructions_updated.txt to BuilderBot Cloud (SaaS) via the same MCP SSE
 * endpoint configured in ~/.cursor/mcp.json (supergateway + x-builderbot-api-key).
 *
 * Usage (from repo root):
 *   node scripts/sync-builderbot-maestro.mjs
 *
 * Optional: BUILDERBOT_SSE_URL override (default matches mcp.json).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

function loadBuilderBotApiKeyFromMcpJson() {
  const p = path.join(os.homedir(), ".cursor", "mcp.json");
  const cfg = JSON.parse(readFileSync(p, "utf8"));
  const args = cfg?.mcpServers?.["builderbot-mcp"]?.args;
  if (!Array.isArray(args)) {
    throw new Error("No mcpServers.builderbot-mcp.args in ~/.cursor/mcp.json");
  }
  const header = args.find((a) => String(a).startsWith("x-builderbot-api-key:"));
  if (!header) {
    throw new Error("x-builderbot-api-key header not found in builderbot-mcp args");
  }
  return header.split(":", 2)[1].trim();
}

function loadDefaultSseUrlFromMcpJson() {
  const p = path.join(os.homedir(), ".cursor", "mcp.json");
  const cfg = JSON.parse(readFileSync(p, "utf8"));
  const args = cfg?.mcpServers?.["builderbot-mcp"]?.args;
  if (!Array.isArray(args)) throw new Error("builderbot-mcp args missing");
  const i = args.indexOf("--sse");
  if (i === -1 || !args[i + 1]) throw new Error("--sse URL not found");
  return String(args[i + 1]).trim();
}

function buildPayload() {
  const minPath = path.join(REPO_ROOT, "scripts", "mcp_args.min.json");
  const min = JSON.parse(readFileSync(minPath, "utf8"));
  const { projectId, flowId, answerId } = min;
  if (!projectId || !flowId || !answerId) {
    throw new Error("scripts/mcp_args.min.json missing projectId / flowId / answerId");
  }
  const txtPath = path.join(REPO_ROOT, "scripts", "instructions_updated.txt");
  const instructions = readFileSync(txtPath, "utf8");
  if (!instructions.includes("ATILIO_MAESTRO_WARA")) {
    throw new Error("instructions_updated.txt no parece ser el maestro Atilio (falta cabecera)");
  }
  return {
    projectId,
    flowId,
    answerId,
    assistant: { instructions },
  };
}

async function main() {
  const key = loadBuilderBotApiKeyFromMcpJson();
  const sseHref = process.env.BUILDERBOT_SSE_URL || loadDefaultSseUrlFromMcpJson();
  const sseUrl = new URL(sseHref);
  const payload = buildPayload();

  const transport = new SSEClientTransport(sseUrl, {
    requestInit: {
      headers: {
        "x-builderbot-api-key": key,
      },
    },
  });

  const client = new Client({ name: "empliados-sync-atilio", version: "1.0.0" });
  await client.connect(transport);

  const result = await client.callTool({
    name: "builderbot_update_answer",
    arguments: payload,
  });

  await client.close();

  const text = JSON.stringify(result?.content ?? result, null, 2);
  console.log(text);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
