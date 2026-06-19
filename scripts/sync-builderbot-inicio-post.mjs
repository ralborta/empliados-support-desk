#!/usr/bin/env node
/**
 * Inicio + Elegir + Cambiar: POST /check con {from}+{body} (GET ?selection={{body}} no llega desde BB).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { homedir } from "os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

const PROJECT_ID = "7d4339ee-2a9b-424e-92f6-ad7790c1662f";
const API_KEY = "31abb735b990bcde9f41ff1b3a3076d8269b92a7676ceecc07d3fa52ae577b62";
const BASE = "https://wara.nivel41.com";
const CHECK_URL = `${BASE}/api/builderbot/customer-registered/check`;
const SELECT_URL = `${BASE}/api/builderbot/customer-registered/select-company`;

const FLOWS = {
  inicio: "0002c201-c25b-4199-bc03-4567a9e23d49",
  elegir: "c4b5127a-76fd-4cb2-8b43-d99685b5c50a",
  cambiar: "3693a7a9-b5f2-4a66-97f3-acef85dab201",
  router: "5895dde2-c0df-41c2-8a35-0895331aefbf",
  derivar: "4d2df610-426b-4239-b720-7eed5a5f0804",
};

const ANSWERS = {
  inicioHttp: "f9901e83-6dca-4bbe-897e-721acc5bd871",
  elegirHttp: "682abeb0-2718-4a42-847f-9e972a8e90ef",
  cambiarReset: "c1891f82-32d9-4056-93d7-03739b45b496",
  cambiarCapture: "d2d3062d-c8d9-4be0-bd74-323629ba05bc",
  cambiarSelect: "a81b5c62-f672-4030-9648-63f20ce8dbd0",
};

const inicioRules = [
  { conditionRule: "nextFlow_s", conditionValue: "derivar", condition: "===", conditionFlowId: FLOWS.derivar },
  { conditionRule: "nextFlow_s", conditionValue: "router", condition: "===", conditionFlowId: FLOWS.router },
];

const pickRules = [
  { conditionRule: "nextFlow_s", conditionValue: "router", condition: "===", conditionFlowId: FLOWS.router },
  { conditionRule: "ok_s", conditionValue: "true", condition: "===", conditionFlowId: FLOWS.router },
];

function checkHttpPlugin(rules = inicioRules) {
  return {
    http: {
      url: CHECK_URL,
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
      body: { from: "{from}", body: "{body}", api_key: API_KEY },
      messageMapping: "{message}",
      avoidResponse: false,
      rules,
    },
  };
}

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
  const client = new Client({ name: "sync-inicio-post", version: "1.0.0" });
  await client.connect(transport);

  // Inicio (WELCOME): POST check — body del mensaje del cliente llega en JSON.
  await client.callTool({
    name: "builderbot_update_answer",
    arguments: {
      projectId: PROJECT_ID,
      flowId: FLOWS.inicio,
      answerId: ANSWERS.inicioHttp,
      type: "add_http",
      sort: 0,
      options: { capture: false },
      plugins: checkHttpPlugin(inicioRules),
    },
  });
  console.log("Inicio → POST /check OK");

  // Elegir (Router manda acá): mismo POST check.
  await client.callTool({
    name: "builderbot_update_answer",
    arguments: {
      projectId: PROJECT_ID,
      flowId: FLOWS.elegir,
      answerId: ANSWERS.elegirHttp,
      type: "add_http",
      sort: 0,
      message: "Validar empresa elegida",
      options: { capture: false },
      plugins: checkHttpPlugin(pickRules),
    },
  });
  console.log("Elegir → POST /check OK");

  // Cambiar: reset → captura respuesta → POST select-company (no depende de WELCOME).
  await client.callTool({
    name: "builderbot_update_answer",
    arguments: {
      projectId: PROJECT_ID,
      flowId: FLOWS.cambiar,
      answerId: ANSWERS.cambiarReset,
      type: "add_http",
      sort: 0,
      options: { capture: false },
      plugins: {
        http: {
          url: SELECT_URL,
          method: "POST",
          headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
          body: { from: "{from}", reset: "1" },
          messageMapping: "{message}",
          avoidResponse: false,
          rules: [],
        },
      },
    },
  });

  await client.callTool({
    name: "builderbot_update_answer",
    arguments: {
      projectId: PROJECT_ID,
      flowId: FLOWS.cambiar,
      answerId: ANSWERS.cambiarCapture,
      type: "add_text",
      sort: 1,
      message: "\u200b",
      options: { capture: true, sensitive: false, delay: 0 },
    },
  });

  await client.callTool({
    name: "builderbot_update_answer",
    arguments: {
      projectId: PROJECT_ID,
      flowId: FLOWS.cambiar,
      answerId: ANSWERS.cambiarSelect,
      type: "add_http",
      sort: 2,
      options: { capture: false },
      plugins: {
        http: {
          url: SELECT_URL,
          method: "POST",
          headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
          body: { from: "{from}", companyName: "{body}" },
          messageMapping: "{message}",
          avoidResponse: false,
          rules: pickRules,
        },
      },
    },
  });
  console.log("Cambiar → reset + capture + select OK");

  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
