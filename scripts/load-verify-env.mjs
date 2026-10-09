#!/usr/bin/env node
/**
 * Carga .env.local / .env.production.local para scripts verify-* con DB real.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

export function loadVerifyEnv() {
  for (const name of [".env.production.local", ".env.local"]) {
    const file = path.join(ROOT, name);
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

export function requireDatabaseUrl(suiteName) {
  loadVerifyEnv();
  if (!process.env.DATABASE_URL?.trim()) {
    console.error(
      `✗ ${suiteName}: DATABASE_URL requerida (definir en .env.local o entorno CI).`,
    );
    process.exit(1);
  }
}
