#!/usr/bin/env node
/**
 * Certificados: un solo HTTP (sin texto+capture duplicado).
 * La patente y confirmación las resuelve el backend.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { homedir } from "os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

const PROJECT_ID = "7d4339ee-2a9b-424e-92f6-ad7790c1662f";
const FLOW_ID = "fd2e658c-f547-4ec6-b64f-00815620bd6b";
const TEXT_ID = "0e9329bd-befd-4f5f-a8a8-0ea864df3da5";
const HTTP_ID = "817f4740-c633-4d3d-b761-95b026f61ed5";
const INICIO_FLOW = "0002c201-c25b-4199-bc03-4567a9e23d49";
const API_KEY = "31abb735b990bcde9f41ff1b3a3076d8269b92a7676ceecc07d3fa52ae577b62";
const BASE = "https://wara.nivel41.com";

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
  const client = new Client({ name: "sync-certificados", version: "1.0.0" });
  await client.connect(transport);

  try {
    await client.callTool({
      name: "builderbot_delete_answer",
      arguments: { projectId: PROJECT_ID, flowId: FLOW_ID, answerId: TEXT_ID },
    });
    console.log("Eliminado nodo texto+capture duplicado");
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
          url: `${BASE}/api/wara/certificados`,
          method: "POST",
          headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
          body: { from: "{from}", rawText: "{body}" },
          messageMapping: "{message}",
          avoidResponse: false,
          rules: [
            {
              conditionRule: "confirmationRequired_s",
              conditionValue: "true",
              condition: "===",
              conditionFlowId: INICIO_FLOW,
            },
            {
              conditionRule: "alreadyGenerated_s",
              conditionValue: "true",
              condition: "===",
              conditionFlowId: INICIO_FLOW,
            },
          ],
        },
      },
    },
  });

  console.log("Certificados → HTTP único OK");
  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
