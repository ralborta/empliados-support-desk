#!/usr/bin/env node
/**
 * Restaura nodos HTTP legacy que sync-builderbot-legacy-http-mute.mjs silenció.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { homedir } from "os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

const PROJECT_ID = "7d4339ee-2a9b-424e-92f6-ad7790c1662f";
const API_KEY = "31abb735b990bcde9f41ff1b3a3076d8269b92a7676ceecc07d3fa52ae577b62";

/** flowId, answerId, messageMapping, url, method, body */
const RESTORE = [
  [
    "29a8afe6-2414-42bd-8a17-4baaa93d9b44",
    "e7dd90f4-65b7-49ed-96b4-e0ab6a99402e",
    "{summaryText}",
    "https://wara.nivel41.com/api/wara/unidades",
    "POST",
    { from: "{from}", rawText: "{body}" },
  ],
  [
    "f75f176c-d0b0-4aa4-a579-6af9c53cb4e0",
    null,
    "{message}",
    "https://wara.nivel41.com/api/odoo/ticket",
    "POST",
    { from: "{from}", body: "{body}" },
  ],
  [
    "3693a7a9-b5f2-4a66-97f3-acef85dab201",
    "c1891f82-32d9-4056-93d7-03739b45b496",
    "{message}",
    "https://wara.nivel41.com/api/builderbot/customer-registered/select-company",
    "POST",
    { from: "{from}", reset: "1" },
  ],
  [
    "8f4c81a0-e3ca-4c79-b1c5-d94ce6d661e2",
    null,
    "{message}",
    "https://wara.nivel41.com/api/wara/certificados",
    "POST",
    { from: "{from}", body: "{body}" },
  ],
  [
    "e893d57f-faca-490f-85a1-d833aa926b9a",
    null,
    "{message}",
    "https://wara.nivel41.com/api/wara/mantenimiento-operativo",
    "POST",
    { from: "{from}", body: "{body}" },
  ],
  [
    "fd2e658c-f547-4ec6-b64f-00815620bd6b",
    null,
    "{message}",
    "https://wara.nivel41.com/api/wara/certificados",
    "POST",
    { from: "{from}", body: "{body}" },
  ],
  [
    "42b29014-7560-4a67-bc09-0201eb1efdd5",
    null,
    "{message}",
    "https://wara.nivel41.com/api/wara/mantenimiento-operativo",
    "POST",
    { from: "{from}", body: "{body}" },
  ],
  [
    "b1062a92-0d72-4f90-bcd9-2fa90d76b95f",
    null,
    "{message}",
    "https://wara.nivel41.com/api/wara/odometro-horometro",
    "POST",
    { from: "{from}", body: "{body}" },
  ],
  [
    "aad687f7-caf8-4a33-aa04-e3c552db9e53",
    "f1c84209-88c3-470b-b5e1-a7780f5f539d",
    "...",
    "https://wara.nivel41.com/api/builderbot/customer-registered/{from}/context",
    "GET",
    {},
  ],
];

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
  const client = new Client({ name: "restore-legacy", version: "1.0.0" });
  await client.connect(transport);

  let n = 0;
  for (const [flowId, answerIdHint, mapping, url, method, body] of RESTORE) {
    const listed = await client.callTool({
      name: "builderbot_list_answers",
      arguments: { projectId: PROJECT_ID, flowId },
    });
    const answers = JSON.parse(listed.content[0].text).answers ?? [];
    const answer = answerIdHint
      ? answers.find((a) => a.id === answerIdHint)
      : answers.find((a) => a.type === "add_http" && a.plugins?.http);
    if (!answer?.plugins?.http) {
      console.warn("Skip", flowId, "- sin HTTP");
      continue;
    }
    const http = {
      ...answer.plugins.http,
      url,
      method,
      body,
      messageMapping: mapping,
      avoidResponse: false,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": API_KEY,
      },
    };
    await client.callTool({
      name: "builderbot_update_answer",
      arguments: {
        projectId: PROJECT_ID,
        flowId,
        answerId: answer.id,
        plugins: { http },
      },
    });
    console.log("Restored", flowId, mapping);
    n += 1;
  }

  await client.close();
  console.log(`\n${n} nodos restaurados.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
