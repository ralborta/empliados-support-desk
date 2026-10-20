/**
 * Feature flag cerebro semántico unificado.
 * false (default) = router legacy (reglas).
 * true = interpretTurn LLM es la única autoridad semántica.
 */
export function isUnifiedSemanticBrainEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = env.WARA_V2_UNIFIED_SEMANTIC_BRAIN?.trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

/**
 * Saludo humano determinístico (nombre + franja horaria AR).
 * Solo aplica a TurnDecision ya clasificado como saludo (socialAct=greeting).
 * Off por defecto.
 */
export function isHumanizedGreetingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = env.WARA_V2_HUMANIZED_GREETING?.trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

export function semanticModelName(env: NodeJS.ProcessEnv = process.env): string {
  return env.WARA_V2_SEMANTIC_MODEL?.trim() || "gpt-4o-mini";
}

export function semanticTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.WARA_V2_SEMANTIC_TIMEOUT_MS ?? "8000");
  if (!Number.isFinite(n) || n < 1000) return 8000;
  return Math.min(n, 30_000);
}

export type BrainTurnMetrics = {
  brain_version: "unified_v1" | "legacy_rules";
  model: string | null;
  latency_ms: number | null;
  decision_action: string | null;
  decision_intent: string | null;
  confidence: number | null;
  handler: string | null;
  clarification: boolean;
  input_tokens: number | null;
  output_tokens: number | null;
  error: string | null;
};

export function logBrainMetrics(m: BrainTurnMetrics): void {
  // Sin secretos ni texto de usuario.
  console.info(JSON.stringify({ event: "wara_v2_brain_turn", ...m }));
}
