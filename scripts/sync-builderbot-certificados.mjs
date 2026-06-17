#!/usr/bin/env node
/** Certificados: HTTP primero para leer patente del mensaje inicial (sin pedirla de nuevo). */
import { readFileSync } from "node:fs";
import path from "node:path";
import { homedir } from "os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

const PROJECT_ID = "7d4339ee-2a9b-424e-92f6-ad7790c1662f";
const FLOW_ID = "fd2e658c-f547-4ec6-b64f-00815620bd6b";
const TEXT_ID = "0e9329bd-befd-4f5f-a8a8-0ea864df3da5";
const HTTP_ID = "817f4740-c633-4d3d-b761-95b026f61ed5";
const API_KEY = "31abb735b990bcde9f41ff1b3a3076d8269b92a7676ceecc07d3fa52ae577b62";

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
          url: "https://empliados-support-desk.vercel.app/api/wara/certificados",
          method: "POST",
          headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
          body: { from: "{from}", rawText: "{body}" },
          messageMapping: "{message}",
          avoidResponse: false,
          rules: [
            {
              conditionRule: "requiresCompanySelection_s",
              conditionValue: "true",
              condition: "===",
              conditionFlowId: "c4b5127a-76fd-4cb2-8b43-d99685b5c50a",
            },
            {
              conditionRule: "missing_s",
              conditionValue: "patente",
              condition: "===",
              conditionFlowId: FLOW_ID,
            },
          ],
        },
      },
    },
  });

  // Captura solo si falta patente (re-entrada al flow tras missing_s).
  const r2 = await client.callTool({
    name: "builderbot_update_answer",
    arguments: {
      projectId: PROJECT_ID,
      flowId: FLOW_ID,
      answerId: TEXT_ID,
      type: "add_text",
      sort: 1,
      message:
        "Necesito la patente de la unidad para el certificado. Enviámela en un mensaje (formato AA123BB o ABC123).",
      options: { capture: true },
    },
  });

  console.log("Certificados OK", JSON.stringify(r2.content ?? r2));
  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
