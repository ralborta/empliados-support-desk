import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isValidCleanNamespace } from "../config/clean-config.js";

export type CleanMigrationMode = "dry-run" | "check" | "apply";
export function parseCleanMigrationMode(args: readonly string[]): CleanMigrationMode {
  const argument = args.find((value) => value !== "--") ?? "--check";
  return argument === "--apply" ? "apply" : argument === "--dry-run" ? "dry-run" : argument === "--check" ? "check" : (() => { throw new Error("CLEAN_MIGRATION_MODE_INVALID"); })();
}
export interface CleanMigrationAdmin { executeScript(sql: string): Promise<void>; }
const TOKEN = "__CLEAN_SCHEMA__";
const MIGRATION_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "001_clean_runtime.sql");
export async function renderCleanMigration(namespace: string, source?: string): Promise<string> {
  if (!isValidCleanNamespace(namespace)) throw new Error("CLEAN_MIGRATION_UNSAFE_NAMESPACE");
  const template = source ?? await readFile(MIGRATION_PATH, "utf8");
  if (!template.includes(TOKEN)) throw new Error("CLEAN_MIGRATION_PLACEHOLDER_MISSING");
  const rendered = template.replaceAll(TOKEN, namespace);
  if (rendered.includes(TOKEN)) throw new Error("CLEAN_MIGRATION_PLACEHOLDER_REMAINS");
  return rendered;
}
export function checkCleanMigration(sql: string, namespace: string) {
  if (!isValidCleanNamespace(namespace) || sql.includes(TOKEN)) throw new Error("CLEAN_MIGRATION_INVALID");
  for (const required of [`.load_snapshot`, `.commit_turn`, `pg_advisory_xact_lock`, `for update`, `dedupe_message`, `operation_attempt`, `trace_metadata`]) if (!sql.includes(required)) throw new Error("CLEAN_MIGRATION_INCOMPLETE");
  return { valid: true as const, namespace, bytes: Buffer.byteLength(sql) };
}
export async function runCleanMigration(input: Readonly<{ namespace: string; mode: CleanMigrationMode; admin?: CleanMigrationAdmin }>) {
  const sql = await renderCleanMigration(input.namespace); const check = checkCleanMigration(sql, input.namespace);
  if (input.mode === "dry-run") return { mode: input.mode, check, sql } as const;
  if (input.mode === "check") return { mode: input.mode, check } as const;
  if (!input.admin) throw new Error("CLEAN_MIGRATION_ADMIN_REQUIRED");
  await input.admin.executeScript(sql); return { mode: input.mode, check } as const;
}
