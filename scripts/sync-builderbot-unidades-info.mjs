#!/usr/bin/env node
/**
 * Sincroniza prompt y capture:false del flujo Información Unidades (ChatPDF).
 *
 * Uso:
 *   node scripts/sync-builderbot-unidades-info.mjs
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const PROJECT_ID = "7d4339ee-2a9b-424e-92f6-ad7790c1662f";
const FLOW_ID = "52f8a36b-819b-4edb-aeb7-677041797a31";
const CHATPDF_ANSWER_ID = "3aa329af-4b8e-4e55-abe3-ea7a742bd785";
const PROMPT_FILE = "unidades_info_prompt.txt";
const PROMPT_HEADER = "ATILIO_INFO_UNIDADES_WARA";

function loadMcp() {
  const cfg = JSON.parse(readFileSync(path.join(homedir(), ".cursor/mcp.json"), "utf8"));
  const args = cfg?.mcpServers?.["builderbot-mcp"]?.args;
  const header = args.find((a) => String(a).startsWith("x-builderbot-api-key:"));
  return {
    key: header.split(":", 2)[1].trim(),
    sseUrl: args[args.indexOf("--sse") + 1],
  };
}

function loadPrompt() {
  const txtPath = path.join(REPO_ROOT, "scripts", PROMPT_FILE);
  const instructions = readFileSync(txtPath, "utf8");
  if (!instructions.includes(PROMPT_HEADER)) {
    throw new Error(`${PROMPT_FILE} no parece el prompt correcto (falta ${PROMPT_HEADER})`);
  }
  return instructions;
}

async function main() {
  const { key, sseUrl } = loadMcp();
  const transport = new SSEClientTransport(new URL(sseUrl), {
    requestInit: { headers: { "x-builderbot-api-key": key } },
  });
  const client = new Client({ name: "sync-unidades-info", version: "1.0.0" });
  await client.connect(transport);

  const instructions = loadPrompt();

  await client.callTool({
    name: "builderbot_update_answer",
    arguments: {
      projectId: PROJECT_ID,
      flowId: FLOW_ID,
      answerId: CHATPDF_ANSWER_ID,
      options: { capture: false, gotoFlow: null },
      contentSettings: { split: false, interpretLinks: true },
      assistant: { instructions, splitParagraphs: false },
    },
  });

  console.log("Información Unidades → prompt + capture:false OK");
  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
