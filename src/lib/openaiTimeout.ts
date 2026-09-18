export const OPENAI_DEFAULT_TIMEOUT_MS = 4_500;

/** Log de falla LLM por etapa (sin secretos ni prompts). */
export function logLlmStageError(stage: string, err: unknown): void {
  const name = err instanceof Error ? err.name : "Error";
  const message =
    err instanceof Error
      ? err.message.slice(0, 200)
      : String(err).slice(0, 200);
  console.error(
    `[llm_stage_error] stage=${stage} name=${name} message=${message}`,
  );
}

export async function withOpenAiTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs = OPENAI_DEFAULT_TIMEOUT_MS,
  opts?: { stage?: string },
): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await run(controller.signal);
  } catch (err) {
    const stage = opts?.stage?.trim() || "openai_call";
    const wrapped =
      err instanceof Error
        ? err
        : new Error(typeof err === "string" ? err : "unknown_openai_error");
    if (controller.signal.aborted && wrapped.name !== "AbortError") {
      const abortErr = new Error(`timeout_after_${timeoutMs}ms`);
      abortErr.name = "AbortError";
      logLlmStageError(stage, abortErr);
    } else {
      logLlmStageError(stage, wrapped);
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}
