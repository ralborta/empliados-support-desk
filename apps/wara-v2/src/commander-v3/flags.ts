/** Flag aislado — OFF por defecto. No afecta path V2. */

export function isConversationCommanderV3Enabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const v = env.WARA_CONVERSATION_COMMANDER_V3;
  return v === "true" || v === "1";
}

export function commanderV3ModelName(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return (
    env.WARA_CONVERSATION_COMMANDER_V3_MODEL?.trim() ||
    env.WARA_V2_SEMANTIC_MODEL?.trim() ||
    "gpt-4o-mini"
  );
}

export const COMMANDER_V3_PROMPT_VERSION = "v3-commander-2026-08-13x";
