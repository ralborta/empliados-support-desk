#!/usr/bin/env node
/**
 * Fase 2 — Silencia nodos HTTP legacy en BBC que aún usan messageMapping.
 * El backend envía WhatsApp desde /turn; estos flujos no deben mandar {message} literal.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { homedir } from "os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

const PROJECT_ID = "7d4339ee-2a9b-424e-92f6-ad7790c1662f";

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
  const client = new Client({ name: "sync-legacy-mute", version: "1.0.0" });
  await client.connect(transport);

  const flows = JSON.parse(
    (await client.callTool({ name: "builderbot_list_flows", arguments: { projectId: PROJECT_ID } }))
      .content[0].text,
  ).flows;

  let updated = 0;
  for (const flow of flows) {
    let answers = [];
    try {
      const listed = await client.callTool({
        name: "builderbot_list_answers",
        arguments: { projectId: PROJECT_ID, flowId: flow.id },
      });
      answers = JSON.parse(listed.content[0].text).answers ?? [];
    } catch {
      continue;
    }

    for (const answer of answers) {
      const http = answer.plugins?.http;
      if (!http || answer.type !== "add_http") continue;
      const mapping = String(http.messageMapping ?? "");
      if (!mapping || http.avoidResponse === true) continue;
      // Inicio/Elegir ya van por /turn con avoidResponse
      if (http.url?.includes("/api/whatsapp/turn")) continue;

      const nextHttp = {
        ...http,
        messageMapping: "",
        avoidResponse: true,
      };
      await client.callTool({
        name: "builderbot_update_answer",
        arguments: {
          projectId: PROJECT_ID,
          flowId: flow.id,
          answerId: answer.id,
          plugins: { http: nextHttp },
        },
      });
      console.log("Muted", flow.name, "|", mapping, "|", http.url?.slice(0, 70));
      updated += 1;
    }
  }

  await client.close();
  console.log(`\nListo: ${updated} nodos HTTP legacy silenciados.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
