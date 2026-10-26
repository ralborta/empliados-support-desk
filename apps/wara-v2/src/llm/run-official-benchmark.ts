/**
 * Runner CLI del benchmark oficial Fase 8 (evidencia local).
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { runOfficialBenchmark } from "./benchmark-official.js";

function loadKey(): string {
  if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.length > 20) {
    return process.env.OPENAI_API_KEY;
  }
  const p = resolve(process.cwd(), "../../.env.local");
  if (!existsSync(p)) throw new Error("missing_openai_key");
  const m = readFileSync(p, "utf8").match(/^OPENAI_API_KEY=(.+)$/m);
  if (!m) throw new Error("missing_openai_key");
  return m[1]!.trim().replace(/^["']|["']$/g, "");
}

async function main() {
  const outDir = resolve(process.cwd(), ".local-evidence/fase8");
  const { reportPath, report } = await runOfficialBenchmark({
    apiKey: loadKey(),
    outDir,
    repeats: 2,
  });
  const m = report.metrics as Record<string, unknown>;
  const n = report.network as Record<string, unknown>;
  console.log(
    JSON.stringify(
      {
        reportPath,
        model: report.model_official,
        fixtures: report.fixtures_total,
        metrics: m,
        network: {
          hosts: n.hostname_only,
          requests: n.request_count,
          other: n.other_destinations,
        },
        effects: report.effects,
      },
      null,
      2,
    ),
  );
}

void main();
