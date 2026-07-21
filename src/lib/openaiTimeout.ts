export const OPENAI_DEFAULT_TIMEOUT_MS = 4_500;

export async function withOpenAiTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs = OPENAI_DEFAULT_TIMEOUT_MS,
): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await run(controller.signal);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
