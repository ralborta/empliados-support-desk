#!/usr/bin/env node
/**
 * Flujos elegir/cambiar empresa (BuilderBot):
 * - Cada mensaje pasa por WELCOME → no sirve menú+captura en 2 pasos.
 * - Elegir Empresa: un solo HTTP que intenta guardar con {body} y muestra {message}.
 * - Cambiar Empresa: solo reset HTTP; la elección la hace Inicio → Elegir en el próximo turno.
 * - Inicio: messageMapping {message} para errores de auto-selección.
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
const CONTEXT_URL =
  "https://empliados-support-desk.vercel.app/api/builderbot/customer-registered/{from}/context?from={{from}}&selection={{body}}";

const FLOWS = {
  inicio: "0002c201-c25b-4199-bc03-4567a9e23d49",
  elegir: "c4b5127a-76fd-4cb2-8b43-d99685b5c50a",
  cambiar: "3693a7a9-b5f2-4a66-97f3-acef85dab201",
  router: "5895dde2-c0df-41c2-8a35-0895331aefbf",
};

const ANSWERS = {
  inicioHttp: "f9901e83-6dca-4bbe-897e-721acc5bd871",
  elegirText: "753ea570-b8c5-4546-8bff-116a8f053551",
  elegirHttp: "682abeb0-2718-4a42-847f-9e972a8e90ef",
  cambiarReset: "c1891f82-32d9-4056-93d7-03739b45b496",
  cambiarCapture: "0f1c9f03-8ed3-403e-888a-453add4da24f",
  cambiarSave: "8ffff219-a9ec-491f-bcee-9c6208e45616",
};

const selectHttpRules = [
  {
    conditionRule: "ok_s",
    conditionValue: "true",
    condition: "===",
    conditionFlowId: FLOWS.router,
  },
];

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
  const client = new Client({ name: "sync-empresa-flows", version: "1.0.0" });
  await client.connect(transport);

  // Inicio: mostrar error de selección sin re-mandar al menú textual de Elegir.
  await client.callTool({
    name: "builderbot_update_answer",
    arguments: {
      projectId: PROJECT_ID,
      flowId: FLOWS.inicio,
      answerId: ANSWERS.inicioHttp,
      type: "add_http",
      sort: 1,
      options: { capture: false },
      plugins: {
        http: {
          url: CONTEXT_URL,
          method: "GET",
          headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
          body: {},
          messageMapping: "{message}",
          avoidResponse: false,
          rules: [
            {
              conditionRule: "ignore_s",
              conditionValue: "true",
              condition: "===",
              conditionFlowId: "03d37040-357d-4b17-9c23-2ba8ac706454",
            },
            {
              conditionRule: "selectionFailed_s",
              conditionValue: "true",
              condition: "===",
              conditionFlowId: FLOWS.elegir,
            },
            {
              conditionRule: "requiresCompanySelection_s",
              conditionValue: "true",
              condition: "===",
              conditionFlowId: FLOWS.elegir,
            },
            {
              conditionRule: "registered_s",
              conditionValue: "false",
              condition: "===",
              conditionFlowId: "4d2df610-426b-4239-b720-7eed5a5f0804",
            },
            {
              conditionRule: "registered_s",
              conditionValue: "true",
              condition: "===",
              conditionFlowId: FLOWS.router,
            },
          ],
        },
      },
    },
  });

  // Elegir: HTTP único en sort 0 (intenta {body} cada vez que entra el flow).
  await client.callTool({
    name: "builderbot_update_answer",
    arguments: {
      projectId: PROJECT_ID,
      flowId: FLOWS.elegir,
      answerId: ANSWERS.elegirHttp,
      type: "add_http",
      sort: 0,
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

  // Quitar nodo texto+captura viejo (provocaba loop al reiniciar menú cada turno).
  try {
    await client.callTool({
      name: "builderbot_delete_answer",
      arguments: {
        projectId: PROJECT_ID,
        flowId: FLOWS.elegir,
        answerId: ANSWERS.elegirText,
      },
    });
    console.log("Elegir: eliminado nodo texto+captura obsoleto");
  } catch (err) {
    console.warn("Elegir text node:", err.message ?? err);
  }

  // Cambiar: solo reset; la elección la resuelve Inicio → Elegir HTTP en el siguiente mensaje.
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

  for (const id of [ANSWERS.cambiarCapture, ANSWERS.cambiarSave]) {
    try {
      await client.callTool({
        name: "builderbot_delete_answer",
        arguments: {
          projectId: PROJECT_ID,
          flowId: FLOWS.cambiar,
          answerId: id,
        },
      });
      console.log("Cambiar: eliminado nodo", id);
    } catch (err) {
      console.warn("Cambiar delete", id, err.message ?? err);
    }
  }

  console.log("Empresa flows OK");
  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
