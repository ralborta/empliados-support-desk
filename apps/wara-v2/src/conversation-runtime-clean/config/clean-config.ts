export const CLEAN_CONFIG_KEYS = [
  "WARA_CLEAN_RUNTIME_ENABLED",
  "WARA_CLEAN_EXTERNAL_READS_ENABLED",
  "WARA_CLEAN_EXTERNAL_WRITES_ENABLED",
  "WARA_CLEAN_DELIVERY_ENABLED",
  "WARA_CLEAN_LLM_ENABLED",
  "WARA_CLEAN_KB_ENABLED",
  "WARA_CLEAN_PERSISTENCE_NAMESPACE",
] as const;

export type CleanRuntimeConfig = Readonly<{
  runtimeEnabled: boolean;
  externalReadsEnabled: boolean;
  externalWritesEnabled: boolean;
  deliveryEnabled: boolean;
  llmEnabled: boolean;
  kbEnabled: boolean;
  persistenceNamespace: string;
}>;

export type SanitizedCleanHealthConfig = Readonly<{
  runtime: "clean";
  enabled: boolean;
  externalReadsEnabled: boolean;
  externalWritesEnabled: boolean;
  deliveryEnabled: boolean;
  llmEnabled: boolean;
  kbEnabled: boolean;
  persistenceNamespace: "configured" | "missing";
}>;

const DEFAULT_NAMESPACE = "wara_runtime_clean_lab";
function safeNamespace(value: string): boolean {
  if (value.length < 3 || value.length > 63 || value[0]! < "a" || value[0]! > "z") return false;
  return [...value].every((char) => (char >= "a" && char <= "z") || (char >= "0" && char <= "9") || char === "_");
}

function strictBoolean(value: string | undefined, key: string): boolean {
  if (value === undefined || value.trim() === "") return false;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`INVALID_CLEAN_CONFIG:${key}:expected_true_or_false`);
}

export function loadCleanRuntimeConfig(env: NodeJS.ProcessEnv = process.env): CleanRuntimeConfig {
  const config: CleanRuntimeConfig = Object.freeze({
    runtimeEnabled: strictBoolean(env.WARA_CLEAN_RUNTIME_ENABLED, "WARA_CLEAN_RUNTIME_ENABLED"),
    externalReadsEnabled: strictBoolean(env.WARA_CLEAN_EXTERNAL_READS_ENABLED, "WARA_CLEAN_EXTERNAL_READS_ENABLED"),
    externalWritesEnabled: strictBoolean(env.WARA_CLEAN_EXTERNAL_WRITES_ENABLED, "WARA_CLEAN_EXTERNAL_WRITES_ENABLED"),
    deliveryEnabled: strictBoolean(env.WARA_CLEAN_DELIVERY_ENABLED, "WARA_CLEAN_DELIVERY_ENABLED"),
    llmEnabled: strictBoolean(env.WARA_CLEAN_LLM_ENABLED, "WARA_CLEAN_LLM_ENABLED"),
    kbEnabled: strictBoolean(env.WARA_CLEAN_KB_ENABLED, "WARA_CLEAN_KB_ENABLED"),
    persistenceNamespace: (env.WARA_CLEAN_PERSISTENCE_NAMESPACE ?? DEFAULT_NAMESPACE).trim(),
  });
  if (!safeNamespace(config.persistenceNamespace)) {
    throw new Error("INVALID_CLEAN_CONFIG:WARA_CLEAN_PERSISTENCE_NAMESPACE:unsafe_identifier");
  }
  if (!config.runtimeEnabled && (config.externalReadsEnabled || config.externalWritesEnabled || config.deliveryEnabled || config.llmEnabled || config.kbEnabled)) {
    throw new Error("INVALID_CLEAN_CONFIG:runtime_required_for_features");
  }
  if (config.externalWritesEnabled && !config.externalReadsEnabled) {
    throw new Error("INVALID_CLEAN_CONFIG:external_reads_required_for_writes");
  }
  if (config.deliveryEnabled && !config.externalWritesEnabled) {
    throw new Error("INVALID_CLEAN_CONFIG:external_writes_required_for_delivery");
  }
  return config;
}

export function sanitizedCleanHealthConfig(config: CleanRuntimeConfig): SanitizedCleanHealthConfig {
  return Object.freeze({
    runtime: "clean",
    enabled: config.runtimeEnabled,
    externalReadsEnabled: config.externalReadsEnabled,
    externalWritesEnabled: config.externalWritesEnabled,
    deliveryEnabled: config.deliveryEnabled,
    llmEnabled: config.llmEnabled,
    kbEnabled: config.kbEnabled,
    persistenceNamespace: config.persistenceNamespace ? "configured" : "missing",
  });
}
