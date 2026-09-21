/**
 * Copia el cliente Prisma generado a dist/ para que los imports de runtime resuelvan.
 */
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "src/generated");
const dest = join(root, "dist/generated");

if (!existsSync(src)) {
  console.error("Missing src/generated — run prisma:generate first");
  process.exit(1);
}
mkdirSync(dirname(dest), { recursive: true });
cpSync(src, dest, { recursive: true });
console.log("Copied Prisma client to dist/generated");
