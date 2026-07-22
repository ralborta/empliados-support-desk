#!/usr/bin/env node
/**
 * Fase 1 — Inicio delgado: POST /api/whatsapp/turn (contexto + ejecutor en backend).
 * Reemplaza POST /check + salto al Router para trámites operativos.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { homedir } from "os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

const PROJECT_ID = "7d4339ee-2a9b-424e-92f6-ad7790c1662f";
/** Misma clave que el resto de sync scripts (BUILDERBOT_CONTEXT / Pulze). NO usar bbc-… del MCP. */
const CONTEXT_API_KEY =
  process.env.PULZE_API_KEY?.trim() ||
  process.env.BUILDERBOT_CONTEXT_API_KEY?.trim() ||
  "31abb735b990bcde9f41ff1b3a3076d8269b92a7676ceecc07d3fa52ae577b62";
const BASE = process.env.WARA_TURN_BASE_URL?.trim() || "https://wara.nivel41.com";
const TURN_URL = `${BASE}/api/whatsapp/turn`;
const SELECT_URL = `${BASE}/api/builderbot/customer-registered/select-company`;

const FLOWS = {
  inicio: "0002c201-c25b-4199-bc03-4567a9e23d49",
  elegir: "c4b5127a-76fd-4cb2-8b43-d99685b5c50a",
  cambiar: "3693a7a9-b5f2-4a66-97f3-acef85dab201",
  router: "5895dde2-c0df-41c2-8a35-0895331aefbf",
  derivar: "4d2df610-426b-4239-b720-7eed5a5f0804",
  ignorar: "03d37040-357d-4b17-9c23-2ba8ac706454",
};

const ANSWERS = {
  inicioHttp: "f9901e83-6dca-4bbe-897e-721acc5bd871",
  elegirHttp: "682abeb0-2718-4a42-847f-9e972a8e90ef",
  cambiarReset: "c1891f82-32d9-4056-93d7-03739b45b496",
  cambiarCapture: "d2d3062d-c8d9-4be0-bd74-323629ba05bc",
  cambiarSelect: "a81b5c62-f672-4030-9648-63f20ce8dbd0",
};

/** BBC envía {message} desde /turn; backend no manda WA (rollback Fase 2). */
function turnHttpPlugin(apiKey, rules) {
  return {
    http: {
      url: TURN_URL,
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey },
      body: { from: "{from}", body: "{body}", api_key: apiKey },
      messageMapping: "{message}",
      avoidResponse: false,
      rules,
    },
  };
}

function loadMcp() {
  const cfg = JSON.parse(readFileSync(path.join(homedir(), ".cursor/mcp.json"), "utf8"));
  const args = cfg?.mcpServers?.["builderbot-mcp"]?.args;
  if (!Array.isArray(args)) throw new Error("builderbot-mcp no configurado");
  const header = args.find((a) => String(a).startsWith("x-builderbot-api-key:"));
  const key = header.split(":", 2)[1].trim();
  const sseUrl = args[args.indexOf("--sse") + 1];
  if (!CONTEXT_API_KEY || CONTEXT_API_KEY.startsWith("bbc-")) {
    throw new Error(
      "CONTEXT_API_KEY inválida: definí PULZE_API_KEY o BUILDERBOT_CONTEXT_API_KEY (64 chars). No uses la clave bbc- del MCP.",
    );
  }
  return { key, sseUrl, contextKey: CONTEXT_API_KEY };
}

async function main() {
  const { key, sseUrl, contextKey } = loadMcp();
  const inicioRules = [
    { conditionRule: "nextFlow_s", conditionValue: "derivar", condition: "===", conditionFlowId: FLOWS.derivar },
    { conditionRule: "nextFlow_s", conditionValue: "ignore", condition: "===", conditionFlowId: FLOWS.ignorar },
    // router → /turn ya ejecutó el trámite; BBC solo envía message (Fase 1 completa, sin Router GPT).
  ];

  const transport = new SSEClientTransport(new URL(sseUrl), {
    requestInit: { headers: { "x-builderbot-api-key": key } },
  });
  const client = new Client({ name: "sync-inicio-turn", version: "1.0.0" });
  await client.connect(transport);

  for (const [label, flowId, answerId] of [
    ["Inicio", FLOWS.inicio, ANSWERS.inicioHttp],
    ["Elegir", FLOWS.elegir, ANSWERS.elegirHttp],
  ]) {
    await client.callTool({
      name: "builderbot_update_answer",
      arguments: {
        projectId: PROJECT_ID,
        flowId,
        answerId,
        message: label === "Elegir" ? "Validar empresa elegida" : "Hacer peticion http",
        type: "add_http",
        sort: 0,
        options: { capture: false },
        plugins: turnHttpPlugin(contextKey, inicioRules),
      },
    });
    console.log(`${label} → POST /api/whatsapp/turn OK`);
  }

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
          headers: { "Content-Type": "application/json", "x-api-key": contextKey },
          body: { from: "{from}", reset: "1" },
          messageMapping: "{message}",
          avoidResponse: false,
          rules: [],
        },
      },
    },
  });
  console.log("Cambiar → reset OK");

  for (const id of [ANSWERS.cambiarCapture, ANSWERS.cambiarSelect]) {
    try {
      await client.callTool({
        name: "builderbot_delete_answer",
        arguments: { projectId: PROJECT_ID, flowId: FLOWS.cambiar, answerId: id },
      });
    } catch {
      /* optional */
    }
  }

  await client.close();
  console.log("\nFase 1 Inicio sync listo. URL:", TURN_URL);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
