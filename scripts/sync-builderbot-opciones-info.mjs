#!/usr/bin/env node
/**
 * Sincroniza prompt y capture:false del flujo Información Opciones (ChatPDF).
 *
 * Uso:
 *   node scripts/sync-builderbot-opciones-info.mjs
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
const FLOW_ID = "312ea5a6-0493-43e6-b026-05d14bcb6436";
const CHATPDF_ANSWER_ID = "51d23e45-2a51-4400-bdf5-8411ee6d66c7";
const PROMPT_FILE = "opciones_info_prompt.txt";
const PROMPT_HEADER = "ATILIO_INFO_OPCIONES_WARA";

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
  const client = new Client({ name: "sync-opciones-info", version: "1.0.0" });
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

  console.log("Información Opciones → prompt + capture:false OK");
  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
