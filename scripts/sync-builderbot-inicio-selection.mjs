#!/usr/bin/env node
/**
 * Actualiza solo la URL del HTTP de Inicio (WELCOME) para pasar selection={{body}}
 * y permitir auto-elegir empresa cuando el usuario escribe "1", "Wara", etc.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { homedir } from "os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

const PROJECT_ID = "7d4339ee-2a9b-424e-92f6-ad7790c1662f";
const FLOW_ID = "0002c201-c25b-4199-bc03-4567a9e23d49";
const ANSWER_ID = "f9901e83-6dca-4bbe-897e-721acc5bd871";

const CONTEXT_URL =
  "https://empliados-support-desk.vercel.app/api/builderbot/customer-registered/{from}/context?from={{from}}&selection={{body}}";

function loadMcp() {
  const cfg = JSON.parse(readFileSync(path.join(homedir(), ".cursor/mcp.json"), "utf8"));
  const args = cfg?.mcpServers?.["builderbot-mcp"]?.args;
  if (!Array.isArray(args)) throw new Error("builderbot-mcp no configurado");
  const header = args.find((a) => String(a).startsWith("x-builderbot-api-key:"));
  const key = header.split(":", 2)[1].trim();
  const sseUrl = args[args.indexOf("--sse") + 1];
  return { key, sseUrl };
}

async function main() {
  const { key, sseUrl } = loadMcp();
  const transport = new SSEClientTransport(new URL(sseUrl), {
    requestInit: { headers: { "x-builderbot-api-key": key } },
  });
  const client = new Client({ name: "sync-inicio-selection", version: "1.0.0" });
  await client.connect(transport);

  const listed = await client.callTool({
    name: "builderbot_list_answers",
    arguments: { projectId: PROJECT_ID, flowId: FLOW_ID },
  });
  const answers = JSON.parse(listed.content[0].text).answers;
  const current = answers.find((a) => a.id === ANSWER_ID);
  if (!current?.plugins?.http) throw new Error("HTTP de Inicio no encontrado");

  const http = { ...current.plugins.http, url: CONTEXT_URL };
  const result = await client.callTool({
    name: "builderbot_update_answer",
    arguments: {
      projectId: PROJECT_ID,
      flowId: FLOW_ID,
      answerId: ANSWER_ID,
      plugins: { http },
    },
  });
  console.log("OK", JSON.stringify(result.content ?? result));
  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
