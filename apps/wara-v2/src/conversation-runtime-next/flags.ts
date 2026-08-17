/** Runtime Next — flag aislado del Commander V3 legacy. */

export const RUNTIME_NEXT_PROMPT_VERSION = "runtime-next-2026-08-17b";
export const RUNTIME_NEXT_SCHEMA_VERSION = "1.0.0";
export const SERVICE_REGISTRY_VERSION = "1.0.0";

export function isConversationRuntimeNextEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const v = env.WARA_CONVERSATION_RUNTIME_NEXT;
  return v === "true" || v === "1";
}

export function runtimeNextModelName(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return (
    env.WARA_CONVERSATION_RUNTIME_NEXT_MODEL?.trim() ||
    env.WARA_CONVERSATION_COMMANDER_V3_MODEL?.trim() ||
    env.WARA_V2_SEMANTIC_MODEL?.trim() ||
    "gpt-4o-mini"
  );
}

/** Información para /health */
export function runtimeHealthInfo(env: NodeJS.ProcessEnv = process.env): {
  runtime: "next" | "commander_v3" | "v2";
  runtimeNextEnabled: boolean;
  commanderV3Enabled: boolean;
  promptVersion: string;
  registryVersion: string;
  schemaVersion: string;
  model: string;
} {
  const next = isConversationRuntimeNextEnabled(env);
  const v3 =
    env.WARA_CONVERSATION_COMMANDER_V3 === "true" ||
    env.WARA_CONVERSATION_COMMANDER_V3 === "1";
  return {
    runtime: next ? "next" : v3 ? "commander_v3" : "v2",
    runtimeNextEnabled: next,
    commanderV3Enabled: v3,
    promptVersion: next ? RUNTIME_NEXT_PROMPT_VERSION : "",
    registryVersion: SERVICE_REGISTRY_VERSION,
    schemaVersion: RUNTIME_NEXT_SCHEMA_VERSION,
    model: runtimeNextModelName(env),
  };
}
