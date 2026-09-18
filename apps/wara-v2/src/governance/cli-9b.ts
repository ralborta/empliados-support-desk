/**
 * CLI Fase 9B — no conecta a plataformas; solo lee el dropbox local.
 *
 * Uso:
 * 1) Exportá manualmente el JSON al dropbox.
 * 2) pnpm --filter @wara-v2/app exec tsx src/governance/cli-9b.ts validate --file=export.json
 * 3) pnpm --filter @wara-v2/app exec tsx src/governance/cli-9b.ts run --file=export.json
 * 4) Revisá la muestra humana en 06-reports-sanitized/
 * 5) pnpm --filter @wara-v2/app exec tsx src/governance/cli-9b.ts run --file=export.json --human-approved
 */
import { runPhase9BPipeline } from "./run-9b.js";
import { validateHistoricalExport } from "./historical.js";
import { ensureGovDirs, GOV_DIRS } from "./paths.js";
import {
  revokeHistoricalAuthorization,
} from "./authorize.js";
import { purgeDataset } from "./pipeline.js";

function arg(name: string): string | undefined {
  const p = process.argv.find((a) => a.startsWith(`--${name}=`));
  return p?.slice(name.length + 3);
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main() {
  ensureGovDirs();
  const cmd = process.argv[2] ?? "help";
  const file = arg("file");

  if (cmd === "help" || cmd === "--help") {
    console.log(
      JSON.stringify(
        {
          dropbox: GOV_DIRS.drop,
          steps: [
            "Exportar manualmente JSON (synthetic:false) al dropbox",
            "validate --file=...",
            "run --file=...  (genera auth + muestra humana)",
            "run --file=... --human-approved  (sella y evalúa offline)",
            "purge --dataset=... --confirm=DELETE:<id>",
          ],
          format: {
            synthetic: false,
            tenant_id: "tenant_internal_ops",
            messages: [
              {
                tenant_id: "tenant_internal_ops",
                conversation_id: "tmp_conv_001",
                turn_index: 0,
                message_role: "user",
                text: "...",
                received_at: "2026-06-01T12:00:00.000Z",
              },
            ],
          },
        },
        null,
        2,
      ),
    );
    return;
  }

  if (cmd === "validate") {
    if (!file) throw new Error("missing --file=");
    const v = validateHistoricalExport(file);
    console.log(JSON.stringify(v, null, 2));
    process.exit(v.ok ? 0 : 1);
  }

  if (cmd === "run") {
    if (!file) throw new Error("missing --file=");
    const report = await runPhase9BPipeline({
      filename: file,
      issueAuth: true,
      humanApproved: hasFlag("human-approved"),
      approver: "Raúl Alborta",
    });
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  if (cmd === "purge") {
    const dataset = arg("dataset");
    const confirm = arg("confirm");
    if (!dataset || !confirm) throw new Error("need --dataset= and --confirm=");
    revokeHistoricalAuthorization();
    const dry = hasFlag("dry-run");
    const r = purgeDataset(dataset, { dryRun: dry, confirm });
    console.log(JSON.stringify(r, null, 2));
    return;
  }

  throw new Error(`unknown_command:${cmd}`);
}

void main();
