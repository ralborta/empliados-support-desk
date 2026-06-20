#!/usr/bin/env node
/**
 * ConfirmOdo: ejecuta CONFIRMO de odómetro contra wara.nivel41.com.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { homedir } from "os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

const PROJECT_ID = "7d4339ee-2a9b-424e-92f6-ad7790c1662f";
const FLOW_ID = "b1062a92-0d72-4f90-bcd9-2fa90d76b95f";
const HTTP_ID = "0737b9bb-9683-4e9f-9d9d-3a7b316890bd";
const ELEGIR_FLOW = "c4b5127a-76fd-4cb2-8b43-d99685b5c50a";
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
  const client = new Client({ name: "sync-confirm-odo", version: "1.0.0" });
  await client.connect(transport);

  await client.callTool({
    name: "builderbot_update_answer",
    arguments: {
      projectId: PROJECT_ID,
      flowId: FLOW_ID,
      answerId: HTTP_ID,
      type: "add_http",
      sort: 1,
      options: { capture: false },
      plugins: {
        http: {
          url: `${BASE}/api/wara/odometro-horometro`,
          method: "POST",
          headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
          body: { from: "{from}", rawText: "{body}", confirm: "{body}" },
          messageMapping: "{message}",
          avoidResponse: false,
          rules: [
            {
              conditionRule: "requiresCompanySelection_s",
              conditionValue: "true",
              condition: "===",
              conditionFlowId: ELEGIR_FLOW,
            },
          ],
        },
      },
    },
  });

  console.log("ConfirmOdo → wara.nivel41.com OK");
  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
