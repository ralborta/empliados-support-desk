#!/usr/bin/env node
/**
 * Push subflow prompts to BuilderBot Cloud (SaaS) via MCP SSE.
 *
 * Usage:
 *   node scripts/sync-builderbot-subflow-prompts.mjs
 *   node scripts/sync-builderbot-subflow-prompts.mjs odometer
 *   node scripts/sync-builderbot-subflow-prompts.mjs consulta
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const PROJECT_ID = "7d4339ee-2a9b-424e-92f6-ad7790c1662f";

const SUBFLOWS = {
  odometer: {
    flowId: "ae2a5ae9-c289-448c-a068-3cb8c65a2e7f",
    answerId: "0b66245a-c7cf-41e0-8eda-e30d74b80d96",
    file: "odometro_prompt.txt",
    header: "ATILIO_SUBFLUJO_ODOMETRO",
  },
  consulta: {
    flowId: "5939a04e-5a5a-4c59-83b6-31172eba4828",
    answerId: "790bd170-0443-4129-be5b-9944b4c03911",
    file: "consulta_unidad_prompt.txt",
    header: "ATILIO_SUBFLUJO_CONSULTA_UNIDAD",
  },
};

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

function buildPayload(key) {
  const cfg = SUBFLOWS[key];
  if (!cfg) throw new Error(`Subflow desconocido: ${key}`);
  const txtPath = path.join(REPO_ROOT, "scripts", cfg.file);
  const instructions = readFileSync(txtPath, "utf8");
  if (!instructions.includes(cfg.header)) {
    throw new Error(`${cfg.file} no parece ser el prompt correcto (falta ${cfg.header})`);
  }
  return {
    projectId: PROJECT_ID,
    flowId: cfg.flowId,
    answerId: cfg.answerId,
    assistant: { instructions },
  };
}

async function syncOne(client, key) {
  const payload = buildPayload(key);
  const result = await client.callTool({
    name: "builderbot_update_answer",
    arguments: payload,
  });
  console.log(`[${key}] OK`, JSON.stringify(result?.content ?? result));
}

async function main() {
  const filter = process.argv[2];
  const keys = filter ? [filter] : Object.keys(SUBFLOWS);
  for (const k of keys) {
    if (!SUBFLOWS[k]) {
      throw new Error(`Subflow desconocido: ${k}. Usá: odometer | consulta`);
    }
  }

  const key = loadBuilderBotApiKeyFromMcpJson();
  const sseHref = process.env.BUILDERBOT_SSE_URL || loadDefaultSseUrlFromMcpJson();
  const sseUrl = new URL(sseHref);

  const transport = new SSEClientTransport(sseUrl, {
    requestInit: { headers: { "x-builderbot-api-key": key } },
  });

  const client = new Client({ name: "empliados-sync-subflows", version: "1.0.0" });
  await client.connect(transport);

  for (const k of keys) {
    await syncOne(client, k);
  }

  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
