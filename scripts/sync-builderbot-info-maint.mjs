#!/usr/bin/env node
/**
 * Info Mantenimiento: sin capture en el asistente (evita loop atrapado).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { homedir } from "os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

const PROJECT_ID = "7d4339ee-2a9b-424e-92f6-ad7790c1662f";
const FLOW_ID = "069bcb65-7503-433c-a4ae-1dd89cd26471";
const OPENAI_ID = "ca1aff0d-b862-4be8-a4d4-6b160ce1bfba";

function loadMcp() {
  const cfg = JSON.parse(readFileSync(path.join(homedir(), ".cursor/mcp.json"), "utf8"));
  const args = cfg?.mcpServers?.["builderbot-mcp"]?.args;
  const header = args.find((a) => String(a).startsWith("x-builderbot-api-key:"));
  return {
    key: header.split(":", 2)[1].trim(),
    sseUrl: args[args.indexOf("--sse") + 1],
  };
}

async function main() {
  const { key, sseUrl } = loadMcp();
  const transport = new SSEClientTransport(new URL(sseUrl), {
    requestInit: { headers: { "x-builderbot-api-key": key } },
  });
  const client = new Client({ name: "sync-info-maint", version: "1.0.0" });
  await client.connect(transport);

  await client.callTool({
    name: "builderbot_update_answer",
    arguments: {
      projectId: PROJECT_ID,
      flowId: FLOW_ID,
      answerId: OPENAI_ID,
      options: { capture: false },
    },
  });

  console.log("Info Mantenimiento → capture:false OK");
  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
