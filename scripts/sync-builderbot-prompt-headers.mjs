#!/usr/bin/env node
/**
 * Unifica encabezados de prompts IA en BuilderBot: (BuilderBot …) → (BB Whatsapp).
 * Recorre todos los flows del proyecto y actualiza add_chatpdf con openai.
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
  const header = args.find((a) => String(a).startsWith("x-builderbot-api-key:"));
  return {
    key: header.split(":", 2)[1].trim(),
    sseUrl: args[args.indexOf("--sse") + 1],
  };
}

function extractText(result) {
  const content = result?.content ?? result;
  const arr = Array.isArray(content) ? content : [content];
  const textNode = arr.find((c) => c && c.type === "text");
  const raw = textNode?.text ?? (typeof content === "string" ? content : JSON.stringify(content));
  return JSON.parse(raw);
}

/** Solo la primera línea (encabezado === … ===). */
function fixPromptHeader(text) {
  if (!text?.trim()) return text;
  const lines = text.split("\n");
  let header = lines[0];
  const before = header;

  if (/BuilderBot/i.test(header)) {
    header = header
      .replace(/\(BuilderBot Cloud SaaS\)/gi, "(BB Whatsapp)")
      .replace(/\(BuilderBot\)/gi, "(BB Whatsapp)");
  } else if (/^=== .+ ===\s*$/.test(header) && !/\(BB Whatsapp\)/i.test(header)) {
    header = header.replace(/^(=== .+) ===\s*$/, "$1 (BB Whatsapp) ===");
  }

  if (header === before) return text;
  lines[0] = header;
  return lines.join("\n");
}

async function main() {
  const { key, sseUrl } = loadMcp();
  const transport = new SSEClientTransport(new URL(sseUrl), {
    requestInit: { headers: { "x-builderbot-api-key": key } },
  });
  const client = new Client({ name: "sync-prompt-headers", version: "1.0.0" });
  await client.connect(transport);

  const flowsListed = await client.callTool({
    name: "builderbot_list_flows",
    arguments: { projectId: PROJECT_ID },
  });
  const { flows } = extractText(flowsListed);

  let updated = 0;
  for (const flow of flows) {
    const listed = await client.callTool({
      name: "builderbot_list_answers",
      arguments: { projectId: PROJECT_ID, flowId: flow.id },
    });
    const { answers } = extractText(listed);
    for (const ans of answers ?? []) {
      const current = ans?.plugins?.openai?.assistantInstructions;
      if (!current?.trim()) continue;
      const next = fixPromptHeader(current);
      if (next === current) {
        console.log(`[${flow.name}] ${ans.id.slice(0, 8)}… sin cambio (${current.split("\n")[0]})`);
        continue;
      }
      try {
        await client.callTool({
          name: "builderbot_update_answer",
          arguments: {
            projectId: PROJECT_ID,
            flowId: flow.id,
            answerId: ans.id,
            assistant: { instructions: next },
          },
        });
      } catch (err) {
        console.warn(`[${flow.name}] ${ans.id.slice(0, 8)}… skip: ${err.message ?? err}`);
        continue;
      }
      updated++;
      console.log(`[${flow.name}] OK`);
      console.log(`  antes: ${current.split("\n")[0]}`);
      console.log(`  después: ${next.split("\n")[0]}`);
    }
  }

  console.log(`\nEncabezados actualizados: ${updated}`);
  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
