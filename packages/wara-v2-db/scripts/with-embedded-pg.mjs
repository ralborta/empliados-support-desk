#!/usr/bin/env node
/**
 * Levanta PostgreSQL embebido descartable, aplica migraciones V2 y ejecuta un comando.
 * No usa Docker ni bases compartidas. Nunca toca DATABASE_URL de V1.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import EmbeddedPostgres from "embedded-postgres";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../../..");
const schemaPath = join(repoRoot, "prisma-v2/schema.prisma");

async function freePort() {
  return await new Promise((resolve, reject) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const addr = s.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      s.close((err) => (err ? reject(err) : resolve(port)));
    });
    s.on("error", reject);
  });
}

function run(cmd, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: repoRoot,
      env,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(" ")} exited ${code}`));
    });
  });
}

const userArgs = process.argv.slice(2);
if (userArgs.length === 0) {
  console.error("Usage: with-embedded-pg.mjs <command> [args...]");
  process.exit(2);
}

const dataDir = mkdtempSync(join(tmpdir(), "wara-v2-pg-"));
const port = await freePort();
const password = "wara_v2_local_only";

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: "postgres",
  password,
  port,
  persistent: false,
  onLog: () => {},
  onError: (msg) => console.error("[embedded-pg]", msg),
});

let exitCode = 0;
try {
  console.log(`[wara-v2-db] Starting embedded PostgreSQL on 127.0.0.1:${port}`);
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("wara_v2");
  const url = `postgresql://postgres:${encodeURIComponent(password)}@127.0.0.1:${port}/wara_v2?schema=public`;

  const env = {
    ...process.env,
    WARA_V2_DATABASE_URL: url,
    // Explicit isolation: never let tests inherit V1 URL as authority.
    DATABASE_URL:
      process.env.DATABASE_URL_V1_PROBE ??
      "postgresql://v1-isolation-probe.invalid/db",
  };

  console.log("[wara-v2-db] prisma migrate deploy (local discardable only)");
  await run(
    "pnpm",
    [
      "--filter",
      "@wara-v2/db",
      "exec",
      "prisma",
      "migrate",
      "deploy",
      "--schema",
      schemaPath,
    ],
    env,
  );

  console.log(`[wara-v2-db] Running: ${userArgs.join(" ")}`);
  await run(userArgs[0], userArgs.slice(1), env);
} catch (err) {
  console.error(err);
  exitCode = 1;
} finally {
  try {
    await pg.stop();
  } catch {
    /* ignore */
  }
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

process.exit(exitCode);
