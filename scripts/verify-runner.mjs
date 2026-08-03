#!/usr/bin/env node
/**
 * Ejecutor paralelo de suites verify-*. Evita npx por suite y corre en pool.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

const DEFAULT_CONCURRENCY = Math.min(
  16,
  Math.max(4, Number(process.env.VERIFY_CONCURRENCY) || 12),
);

function tsxCommand() {
  // tsx como devDependency: un solo binario, sin npx por suite.
  const localTsx = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
  return { cmd: process.execPath, args: [localTsx] };
}

function runSuite(suite, { quiet }) {
  const file = path.join(__dirname, suite);
  const { cmd, args } = tsxCommand();
  return new Promise((resolve) => {
    const child = spawn(cmd, [...args, file], {
      cwd: ROOT,
      env: process.env,
      stdio: quiet ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    let stdout = "";
    let stderr = "";
    if (quiet) {
      child.stdout?.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr?.on("data", (chunk) => {
        stderr += chunk;
      });
    }
    child.on("close", (code) => {
      resolve({ suite, ok: code === 0, stdout, stderr, code: code ?? 1 });
    });
    child.on("error", (err) => {
      resolve({ suite, ok: false, stdout, stderr: `${stderr}\n${err.message}`, code: 1 });
    });
  });
}

async function runPool(suites, concurrency) {
  const results = new Array(suites.length);
  let next = 0;

  async function worker() {
    while (next < suites.length) {
      const index = next++;
      results[index] = await runSuite(suites[index], { quiet: true });
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, suites.length) }, () => worker()));
  return results;
}

export async function runVerifySuites(suites, opts = {}) {
  const label = opts.label ?? "gate de regresión";
  const concurrency = opts.concurrency ?? DEFAULT_CONCURRENCY;
  const started = Date.now();

  console.log(`▶ ${label} — ${suites.length} suite(s), concurrencia ${concurrency}`);

  const results = await runPool(suites, concurrency);
  let failedSuites = 0;

  for (const r of results) {
    if (r.ok) {
      console.log(`✓ ${r.suite}`);
    } else {
      failedSuites++;
      console.log(`✗ ${r.suite}`);
      if (r.stdout?.trim()) console.log(r.stdout.trimEnd());
      if (r.stderr?.trim()) console.error(r.stderr.trimEnd());
    }
  }

  const elapsedSec = ((Date.now() - started) / 1000).toFixed(1);
  console.log("\n" + "=".repeat(50));
  console.log(`RESUMEN — ${label} (${elapsedSec}s)`);
  console.log("=".repeat(50));

  if (failedSuites > 0) {
    console.error(`\n✗ ${failedSuites} suite(s) con fallas. NO deployar.`);
    process.exit(1);
  }
  console.log("\n✓ Gate OK — todas las suites en verde.");
}
