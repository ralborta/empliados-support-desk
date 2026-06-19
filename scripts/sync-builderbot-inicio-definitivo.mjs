#!/usr/bin/env node
/**
 * Arquitectura definitiva de Inicio (WELCOME):
 * - Backend devuelve nextFlow_s: reply | router | elegir | derivar | ignore
 * - "reply" = solo enviar {message} y terminar (saludos)
 * - Nunca usar add_mute en clientes humanos
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { homedir } from "os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

const PROJECT_ID = "7d4339ee-2a9b-424e-92f6-ad7790c1662f";
const API_KEY = "31abb735b990bcde9f41ff1b3a3076d8269b92a7676ceecc07d3fa52ae577b62";
const CONTEXT_URL =
  "https://wara.nivel41.com/api/builderbot/customer-registered/{from}/context?from={{from}}&selection={{body}}";

const FLOWS = {
  inicio: "0002c201-c25b-4199-bc03-4567a9e23d49",
  elegir: "c4b5127a-76fd-4cb2-8b43-d99685b5c50a",
  derivar: "4d2df610-426b-4239-b720-7eed5a5f0804",
  router: "5895dde2-c0df-41c2-8a35-0895331aefbf",
  ignorar: "03d37040-357d-4b17-9c23-2ba8ac706454",
};
const INICIO_HTTP = "f9901e83-6dca-4bbe-897e-721acc5bd871";

const inicioRules = [
  { conditionRule: "nextFlow_s", conditionValue: "derivar", condition: "===", conditionFlowId: FLOWS.derivar },
  { conditionRule: "nextFlow_s", conditionValue: "router", condition: "===", conditionFlowId: FLOWS.router },
  // nextFlow_s reply/ignore/elegir → sin regla: solo messageMapping y el próximo mensaje vuelve a Inicio
];

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
  const client = new Client({ name: "sync-inicio-definitivo", version: "1.0.0" });
  await client.connect(transport);

  await client.callTool({
    name: "builderbot_update_answer",
    arguments: {
      projectId: PROJECT_ID,
      flowId: FLOWS.inicio,
      answerId: INICIO_HTTP,
      type: "add_http",
      sort: 0,
      options: { capture: false },
      plugins: {
        http: {
          url: CONTEXT_URL,
          method: "GET",
          headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
          body: {},
          messageMapping: "{message}",
          avoidResponse: false,
          rules: inicioRules,
        },
      },
    },
  });

  console.log("Inicio definitivo OK (nextFlow_s)");
  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
