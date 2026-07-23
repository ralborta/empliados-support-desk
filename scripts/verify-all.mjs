#!/usr/bin/env node
/**
 * Gate único de regresión — correr SIEMPRE antes de pushear un cambio de routing/intents.
 * Consolida todos los scripts verify- y simulate- en un solo comando con un solo resultado.
 *
 * Uso: npx tsx scripts/verify-all.mjs   (o: npm test)
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SUITES = [
  "verify-turn-pipeline.mjs",
  "verify-turn-routing.mjs",
  "verify-system-health.mjs",
  "verify-unit-resolution-grounding.mjs",
  "verify-unit-name-vs-plate.mjs",
  "verify-odometer-plate-continuity.mjs",
  "verify-odometer-fecha-hora.mjs",
  "verify-certificate-flow-continuity.mjs",
  "verify-context-continuity-safety.mjs",
  "verify-outbound-dedup.mjs",
  "verify-certificate-crossflow-vague-reference.mjs",
  "verify-brand-mention-in-question.mjs",
  "verify-active-unit-memory.mjs",
  "verify-certificate-flow-superseded.mjs",
  "verify-unit-rejection-loop.mjs",
  "verify-company-continuation-mention.mjs",
  "verify-close-case-resolver-verb.mjs",
  "verify-new-case-request-not-fleet-search.mjs",
  "verify-odometer-vague-unit-start.mjs",
  "verify-odometer-pending-confirm-context.mjs",
  "verify-conversation-closing.mjs",
  "verify-certificate-confirm-pivot.mjs",
  "verify-info-guide-replies.mjs",
  "verify-knowledge-base.mjs",
  "simulate-maintenance-plate-flow.mjs",
  "snapshot-turn-classification.mjs",
];

let failedSuites = 0;
const results = [];

for (const suite of SUITES) {
  const file = path.join(__dirname, suite);
  console.log(`\n▶ ${suite}`);
  const res = spawnSync("npx", ["tsx", file], { stdio: "inherit", cwd: path.join(__dirname, "..") });
  const ok = res.status === 0;
  if (!ok) failedSuites++;
  results.push({ suite, ok });
}

console.log("\n" + "=".repeat(50));
console.log("RESUMEN — gate de regresión");
console.log("=".repeat(50));
for (const r of results) {
  console.log(`${r.ok ? "✓" : "✗"} ${r.suite}`);
}

if (failedSuites > 0) {
  console.error(`\n✗ ${failedSuites} suite(s) con fallas. NO deployar.`);
  process.exit(1);
}
console.log("\n✓ Gate OK — todas las suites en verde.");
