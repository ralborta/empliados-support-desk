#!/usr/bin/env node
/**
 * Info Mantenimiento: solo guía ChatPDF/OpenAI, sin nodo IA Intención al final
 * (evita loop → Gestión Mantenimiento + pedido de patente espurio).
 *
 * Uso: node scripts/sync-builderbot-info-mantenimiento.mjs
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { homedir } from "os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

const PROJECT_ID = "7d4339ee-2a9b-424e-92f6-ad7790c1662f";
const FLOW_ID = "069bcb65-7503-433c-a4ae-1dd89cd26471";
/** Nodo "Detectar si hay que ejecutar" — encadenaba a Gestión Mantenimiento. */
const INTENT_ANSWER_ID = "14c0c912-1aad-4af0-9817-e687013d54f3";

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
  const client = new Client({ name: "sync-info-mantenimiento", version: "1.0.0" });
  await client.connect(transport);

  try {
    await client.callTool({
      name: "builderbot_delete_answer",
      arguments: { projectId: PROJECT_ID, flowId: FLOW_ID, answerId: INTENT_ANSWER_ID },
    });
    console.log("Eliminado nodo IA Intención de Info Mantenimiento");
  } catch (err) {
    console.warn("Delete intent node:", err.message ?? err);
  }

  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
