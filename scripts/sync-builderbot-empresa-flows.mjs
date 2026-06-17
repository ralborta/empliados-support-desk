#!/usr/bin/env node
/**
 * Corrige loop de elegir/cambiar empresa:
 * - Cambiar: reset muestra {message} del backend (no JSON crudo ni literal)
 * - Fallo al guardar → reintento en Elegir Empresa (sin reset de nuevo)
 * - Éxito → Router Wara
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { homedir } from "os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

const PROJECT_ID = "7d4339ee-2a9b-424e-92f6-ad7790c1662f";
const API_KEY = "31abb735b990bcde9f41ff1b3a3076d8269b92a7676ceecc07d3fa52ae577b62";
const SELECT_URL =
  "https://empliados-support-desk.vercel.app/api/builderbot/customer-registered/select-company";

const FLOWS = {
  elegir: "c4b5127a-76fd-4cb2-8b43-d99685b5c50a",
  cambiar: "3693a7a9-b5f2-4a66-97f3-acef85dab201",
  router: "5895dde2-c0df-41c2-8a35-0895331aefbf",
};

function loadMcp() {
  const cfg = JSON.parse(readFileSync(path.join(homedir(), ".cursor/mcp.json"), "utf8"));
  const args = cfg?.mcpServers?.["builderbot-mcp"]?.args;
  const header = args.find((a) => String(a).startsWith("x-builderbot-api-key:"));
  return {
    key: header.split(":", 2)[1].trim(),
    sseUrl: args[args.indexOf("--sse") + 1],
  };
}

const selectHttpRules = [];

async function listAnswers(client, flowId) {
  const r = await client.callTool({
    name: "builderbot_list_answers",
    arguments: { projectId: PROJECT_ID, flowId },
  });
  return JSON.parse(r.content[0].text).answers;
}

async function main() {
  const { key, sseUrl } = loadMcp();
  const transport = new SSEClientTransport(new URL(sseUrl), {
    requestInit: { headers: { "x-builderbot-api-key": key } },
  });
  const client = new Client({ name: "sync-empresa-flows", version: "1.0.0" });
  await client.connect(transport);

  const elegir = await listAnswers(client, FLOWS.elegir);
  const cambiar = await listAnswers(client, FLOWS.cambiar);
  const elegirText = elegir.find((a) => a.type === "add_text");
  const elegirHttp = elegir.find((a) => a.type === "add_http");
  const cambiarReset = cambiar.find((a) => a.sort === 0 && a.type === "add_http");
  const cambiarCapture = cambiar.find((a) => a.type === "add_text");
  const cambiarSave = cambiar.find((a) => a.sort === 2 && a.type === "add_http");

  if (!elegirText || !elegirHttp || !cambiarReset || !cambiarCapture || !cambiarSave) {
    throw new Error("No se encontraron todos los nodos de Elegir/Cambiar Empresa");
  }

  await client.callTool({
    name: "builderbot_update_answer",
    arguments: {
      projectId: PROJECT_ID,
      flowId: FLOWS.elegir,
      answerId: elegirText.id,
      type: "add_text",
      sort: 0,
      message:
        "Veo que este número está asociado a más de una empresa en Wara. ¿De cuál escribís?\n\n{waraContactsText}\n\nRespondé con el número de la opción o con el nombre de la empresa (por ejemplo: WARA o El Cacique).",
      options: { capture: true },
    },
  });

  await client.callTool({
    name: "builderbot_update_answer",
    arguments: {
      projectId: PROJECT_ID,
      flowId: FLOWS.elegir,
      answerId: elegirHttp.id,
      type: "add_http",
      sort: 1,
      options: { capture: false },
      plugins: {
        http: {
          url: SELECT_URL,
          method: "POST",
          headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
          body: { from: "{from}", companyName: "{body}" },
          messageMapping: "{message}",
          avoidResponse: false,
          rules: selectHttpRules,
        },
      },
    },
  });

  await client.callTool({
    name: "builderbot_update_answer",
    arguments: {
      projectId: PROJECT_ID,
      flowId: FLOWS.cambiar,
      answerId: cambiarReset.id,
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
      answerId: cambiarCapture.id,
      type: "add_text",
      sort: 1,
      message: "Respondé con el número de la opción o el nombre de la empresa.",
      options: { capture: true },
    },
  });

  const r = await client.callTool({
    name: "builderbot_update_answer",
    arguments: {
      projectId: PROJECT_ID,
      flowId: FLOWS.cambiar,
      answerId: cambiarSave.id,
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
          rules: selectHttpRules,
        },
      },
    },
  });

  console.log("Empresa flows OK", JSON.stringify(r.content ?? r));
  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
