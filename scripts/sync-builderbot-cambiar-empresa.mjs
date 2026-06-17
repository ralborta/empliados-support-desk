#!/usr/bin/env node
/** Corrige menú Cambiar Empresa: usa {message} del reset HTTP (incluye lista). */
import { readFileSync } from "node:fs";
import path from "node:path";
import { homedir } from "os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

const PROJECT_ID = "7d4339ee-2a9b-424e-92f6-ad7790c1662f";
const FLOW_ID = "3693a7a9-b5f2-4a66-97f3-acef85dab201";
const TEXT_ANSWER_ID = "0f1c9f03-8ed3-403e-888a-453add4da24f";

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
  const client = new Client({ name: "sync-cambiar-empresa", version: "1.0.0" });
  await client.connect(transport);

  const result = await client.callTool({
    name: "builderbot_update_answer",
    arguments: {
      projectId: PROJECT_ID,
      flowId: FLOW_ID,
      answerId: TEXT_ANSWER_ID,
      type: "add_text",
      message: "{message}",
      options: { capture: true },
    },
  });
  console.log("Cambiar Empresa OK", JSON.stringify(result.content ?? result));
  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
