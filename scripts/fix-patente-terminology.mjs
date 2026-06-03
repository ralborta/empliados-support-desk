#!/usr/bin/env node
/**
 * One-off: reemplaza "matrícula" por "patente" en los prompts de IA (add_chatpdf)
 * desplegados en BuilderBot Cloud, leyendo el texto vivo vía MCP y republicándolo.
 *
 * Cubre: Atilio principal (maestro), Cambio Odómetro y Consultar Unidad.
 *
 * Uso: node scripts/fix-patente-terminology.mjs
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

const PROJECT_ID = "7d4339ee-2a9b-424e-92f6-ad7790c1662f";

const TARGETS = [
  { name: "Atilio principal", flowId: "e3e7ad1c-27a9-40a8-8556-a24b758a29c6", answerId: "e926968a-61a3-4476-8cd9-1cb23b557f25" },
  { name: "Cambio Odómetro", flowId: "ae2a5ae9-c289-448c-a068-3cb8c65a2e7f", answerId: "0b66245a-c7cf-41e0-8eda-e30d74b80d96" },
  { name: "Consultar Unidad", flowId: "5939a04e-5a5a-4c59-83b6-31172eba4828", answerId: "790bd170-0443-4129-be5b-9944b4c03911" },
];

function mcpArgs() {
  const p = path.join(os.homedir(), ".cursor", "mcp.json");
  const cfg = JSON.parse(readFileSync(p, "utf8"));
  const args = cfg?.mcpServers?.["builderbot-mcp"]?.args;
  if (!Array.isArray(args)) throw new Error("builderbot-mcp args missing en ~/.cursor/mcp.json");
  const header = args.find((a) => String(a).startsWith("x-builderbot-api-key:"));
  if (!header) throw new Error("x-builderbot-api-key no encontrado");
  const i = args.indexOf("--sse");
  if (i === -1 || !args[i + 1]) throw new Error("--sse URL no encontrada");
  return { key: header.split(":", 2)[1].trim(), sse: String(args[i + 1]).trim() };
}

// Reemplaza matrícula -> patente preservando mayúscula inicial y evitando
// duplicar cuando ya viene "patente / matrícula".
function fixTerminology(text) {
  let out = text;
  // 1) "patente / matrícula" o "patente/matrícula" -> "patente"
  out = out.replace(/patente\s*\/\s*matr[ií]culas?/gi, "patente");
  // 2) plurales
  out = out.replace(/matrículas/g, "patentes").replace(/Matrículas/g, "Patentes");
  out = out.replace(/matriculas/g, "patentes").replace(/Matriculas/g, "Patentes");
  // 3) singular (con y sin acento)
  out = out.replace(/matrícula/g, "patente").replace(/Matrícula/g, "Patente");
  out = out.replace(/matricula/g, "patente").replace(/Matricula/g, "Patente");
  return out;
}

function extractText(result) {
  const content = result?.content ?? result;
  const arr = Array.isArray(content) ? content : [content];
  const textNode = arr.find((c) => c && c.type === "text");
  const raw = textNode?.text ?? (typeof content === "string" ? content : JSON.stringify(content));
  return JSON.parse(raw);
}

async function main() {
  const { key, sse } = mcpArgs();
  const transport = new SSEClientTransport(new URL(sse), {
    requestInit: { headers: { "x-builderbot-api-key": key } },
  });
  const client = new Client({ name: "empliados-fix-patente", version: "1.0.0" });
  await client.connect(transport);

  for (const t of TARGETS) {
    const listed = await client.callTool({
      name: "builderbot_list_answers",
      arguments: { projectId: PROJECT_ID, flowId: t.flowId },
    });
    const parsed = extractText(listed);
    const ans = (parsed.answers || []).find((a) => a.id === t.answerId);
    if (!ans) {
      console.log(`[${t.name}] answer no encontrado, salto`);
      continue;
    }
    const current = ans?.plugins?.openai?.assistantInstructions ?? "";
    const before = (current.match(/matr[ií]cula/gi) || []).length;
    if (before === 0) {
      console.log(`[${t.name}] ya estaba sin "matrícula" (0 ocurrencias)`);
      continue;
    }
    const updated = fixTerminology(current);
    const after = (updated.match(/matr[ií]cula/gi) || []).length;
    await client.callTool({
      name: "builderbot_update_answer",
      arguments: {
        projectId: PROJECT_ID,
        flowId: t.flowId,
        answerId: t.answerId,
        assistant: { instructions: updated },
      },
    });
    console.log(`[${t.name}] OK — reemplazos: ${before} -> ${after} restantes`);
  }

  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
