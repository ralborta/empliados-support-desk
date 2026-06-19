#!/usr/bin/env node
/**
 * Gestión Mantenimiento: un solo HTTP (sin texto+capture que atrapaba al usuario).
 * URL wara.nivel41.com; cambiar empresa vía changeCompany_s → flujo Cambiar.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { homedir } from "os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

const PROJECT_ID = "7d4339ee-2a9b-424e-92f6-ad7790c1662f";
const FLOW_ID = "42b29014-7560-4a67-bc09-0201eb1efdd5";
const HTTP_ID = "2ed738cf-9900-49c0-9655-15907fff3cb9";
const TEXT_CAPTURE_ID = "8f06535f-d411-4efa-9955-2d2034b534b6";
const API_KEY = "31abb735b990bcde9f41ff1b3a3076d8269b92a7676ceecc07d3fa52ae577b62";
const BASE = "https://wara.nivel41.com";
const CAMBIAR_FLOW = "3693a7a9-b5f2-4a66-97f3-acef85dab201";

function loadMcp() {
  const cfg = JSON.parse(readFileSync(path.join(homedir(), ".cursor/mcp.json"), "utf8"));
  const args = cfg?.mcpServers?.["builderbot-mcp"]?.args;
  const header = args.find((a) => String(a).startsWith("x-builderbot-api-key:"));
  return { key: header.split(":", 2)[1].trim(), sseUrl: args[args.indexOf("--sse") + 1] };
}

async function main() {
  const { key, sseUrl } = loadMcp();
  const transport = new SSEClientTransport(new URL(sseUrl), {
    requestInit: { headers: { "x-builderbot-api-key": key } },
  });
  const client = new Client({ name: "sync-mantenimiento", version: "1.0.0" });
  await client.connect(transport);

  try {
    await client.callTool({
      name: "builderbot_delete_answer",
      arguments: { projectId: PROJECT_ID, flowId: FLOW_ID, answerId: TEXT_CAPTURE_ID },
    });
    console.log("Eliminado nodo texto+capture que atrapaba al usuario");
  } catch (err) {
    console.warn("Delete text node:", err.message ?? err);
  }

  await client.callTool({
    name: "builderbot_update_answer",
    arguments: {
      projectId: PROJECT_ID,
      flowId: FLOW_ID,
      answerId: HTTP_ID,
      type: "add_http",
      sort: 0,
      options: { capture: false },
      plugins: {
        http: {
          url: `${BASE}/api/wara/mantenimiento-operativo`,
          method: "POST",
          headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
          body: { from: "{from}", rawText: "{body}" },
          messageMapping: "{message}",
          avoidResponse: false,
          rules: [
            {
              conditionRule: "changeCompany_s",
              conditionValue: "true",
              condition: "===",
              conditionFlowId: CAMBIAR_FLOW,
            },
            {
              conditionRule: "informational_s",
              conditionValue: "true",
              condition: "===",
              conditionFlowId: "0002c201-c25b-4199-bc03-4567a9e23d49",
            },
          ],
        },
      },
    },
  });
  console.log("Gestión Mantenimiento → HTTP único OK");
  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
