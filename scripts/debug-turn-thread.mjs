#!/usr/bin/env node
import { loadTurnThreadContext } from "../src/lib/conversationThread.ts";
import { classifyTurnExecutor } from "../src/lib/whatsappTurnRouter.ts";
import { looksLikeGpsOrUnitStatusQuestion } from "../src/lib/waraApi.ts";
import { hasPendingMaintenancePlateRequest } from "../src/lib/wara.ts";

const phone = process.argv[2] || "5491133788190";
const msgs = process.argv.slice(3).length
  ? process.argv.slice(3)
  : [
      "No sé si mi GPS está marcando bien",
      "quiero ver la ignicio de mi unidad",
      "Nissan",
    ];

for (const text of msgs) {
  const ctx = await loadTurnThreadContext(phone, text);
  const thread = ctx.classificationThread;
  console.log(`\n=== ${text} ===`);
  console.log("executor:", classifyTurnExecutor(text, thread));
  console.log("gpsQ:", looksLikeGpsOrUnitStatusQuestion(text));
  console.log("pendingPlate:", hasPendingMaintenancePlateRequest(thread));
  console.log("--- thread tail ---");
  console.log(thread.slice(-1200));
}
