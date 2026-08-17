import { loadCleanRuntimeConfig, type CleanRuntimeConfig } from "./clean-config.js";

export type CleanLabApplicationConfig = Readonly<{
  runtime: CleanRuntimeConfig; databaseUrl: string | null; apiKey: string; allowedTenants: ReadonlySet<string>;
  host: "127.0.0.1" | "localhost" | "0.0.0.0"; port: number; requestsPerMinute: number;
  statementTimeoutMs: number; connectionTimeoutMs: number; commit: string | null;
  openAiKey: string | null; openAiModel: string | null; waraBaseUrl: string | null; waraToken: string | null;
  odooUrl: string | null; odooApiKey: string | null; odooDb: string | null; odooEmail: string | null;
  scannerUrl: string | null; storageUrl: string | null; deliveryUrl: string | null; deliveryToken: string | null;
  kbApprovedVersion: string | null;
}>;
function requiredText(env: NodeJS.ProcessEnv, key: string): string { const value = env[key]?.trim(); if (!value) throw new Error(`INVALID_CLEAN_LAB_CONFIG:${key}:required`); return value; }
function optionalText(env: NodeJS.ProcessEnv, key: string): string | null { return env[key]?.trim() || null; }
function integer(env: NodeJS.ProcessEnv, key: string, fallback: number, min: number, max: number): number {
  const raw = env[key]?.trim(); const value = raw ? Number(raw) : fallback;
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`INVALID_CLEAN_LAB_CONFIG:${key}:invalid_integer`);
  return value;
}
function host(value: string | undefined): CleanLabApplicationConfig["host"] {
  const candidate = value?.trim() || "127.0.0.1";
  if (candidate !== "127.0.0.1" && candidate !== "localhost" && candidate !== "0.0.0.0") throw new Error("INVALID_CLEAN_LAB_CONFIG:HOST:not_allowed");
  return candidate;
}
function requireWhen(condition: boolean, value: string | null, key: string): void { if (condition && !value) throw new Error(`INVALID_CLEAN_LAB_CONFIG:${key}:required_by_gate`); }

export function loadCleanLabApplicationConfig(env: NodeJS.ProcessEnv = process.env): CleanLabApplicationConfig {
  const runtime = loadCleanRuntimeConfig(env); const apiKey = requiredText(env, "WARA_CLEAN_LAB_API_KEY");
  const tenants = requiredText(env, "WARA_CLEAN_LAB_TENANT_ALLOWLIST").split(",").map((value) => value.trim()).filter(Boolean);
  if (!tenants.length || new Set(tenants).size !== tenants.length) throw new Error("INVALID_CLEAN_LAB_CONFIG:TENANT_ALLOWLIST:invalid");
  const config: CleanLabApplicationConfig = Object.freeze({
    runtime, databaseUrl: optionalText(env, "WARA_CLEAN_DATABASE_URL"), apiKey, allowedTenants: new Set(tenants),
    host: host(env.WARA_CLEAN_BIND_HOST), port: integer(env, "PORT", 8788, 0, 65535), requestsPerMinute: integer(env, "WARA_CLEAN_RATE_LIMIT_PER_MINUTE", 30, 1, 10_000),
    statementTimeoutMs: integer(env, "WARA_CLEAN_DB_STATEMENT_TIMEOUT_MS", 5_000, 100, 120_000), connectionTimeoutMs: integer(env, "WARA_CLEAN_DB_CONNECTION_TIMEOUT_MS", 5_000, 100, 120_000),
    commit: optionalText(env, "GIT_COMMIT_SHA"), openAiKey: optionalText(env, "OPENAI_API_KEY"), openAiModel: optionalText(env, "WARA_CLEAN_OPENAI_MODEL"),
    waraBaseUrl: optionalText(env, "WARA_API_BASE_URL"), waraToken: optionalText(env, "WARA_OBTENER_EMPRESA_TOKEN"),
    odooUrl: optionalText(env, "ODOO_URL"), odooApiKey: optionalText(env, "ODOO_API_KEY"), odooDb: optionalText(env, "ODOO_DB"), odooEmail: optionalText(env, "ODOO_EMAIL"),
    scannerUrl: optionalText(env, "WARA_CLEAN_SCANNER_URL"), storageUrl: optionalText(env, "WARA_CLEAN_STORAGE_URL"),
    deliveryUrl: optionalText(env, "WARA_CLEAN_DELIVERY_URL"), deliveryToken: optionalText(env, "WARA_CLEAN_DELIVERY_TOKEN"), kbApprovedVersion: optionalText(env, "WARA_CLEAN_KB_APPROVED_VERSION"),
  });
  requireWhen(runtime.runtimeEnabled, config.databaseUrl, "WARA_CLEAN_DATABASE_URL");
  requireWhen(runtime.externalReadsEnabled, config.waraBaseUrl, "WARA_API_BASE_URL"); requireWhen(runtime.externalReadsEnabled, config.waraToken, "WARA_OBTENER_EMPRESA_TOKEN");
  for (const [key, value] of [["ODOO_URL", config.odooUrl], ["ODOO_API_KEY", config.odooApiKey], ["ODOO_DB", config.odooDb], ["ODOO_EMAIL", config.odooEmail], ["WARA_CLEAN_SCANNER_URL", config.scannerUrl], ["WARA_CLEAN_STORAGE_URL", config.storageUrl]] as const) requireWhen(runtime.externalWritesEnabled, value, key);
  requireWhen(runtime.deliveryEnabled, config.deliveryUrl, "WARA_CLEAN_DELIVERY_URL"); requireWhen(runtime.deliveryEnabled, config.deliveryToken, "WARA_CLEAN_DELIVERY_TOKEN");
  requireWhen(runtime.llmEnabled, config.openAiKey, "OPENAI_API_KEY"); requireWhen(runtime.llmEnabled, config.openAiModel, "WARA_CLEAN_OPENAI_MODEL");
  if (runtime.kbEnabled && config.kbApprovedVersion !== "clean-seed-1") throw new Error("INVALID_CLEAN_LAB_CONFIG:KB:approved_version_required");
  return config;
}
