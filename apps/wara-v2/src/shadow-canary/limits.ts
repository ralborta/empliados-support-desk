/**
 * Límites 10A — rate, costo diario, timeout. Sin reintentos duplicadores.
 */
export type ShadowLimitsState = {
  window_started: number;
  window_count: number;
  day_key: string;
  day_cost_usd: number;
};

export function createLimitsState(): ShadowLimitsState {
  return {
    window_started: Date.now(),
    window_count: 0,
    day_key: dayKey(new Date()),
    day_cost_usd: 0,
  };
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function checkRateLimit(
  state: ShadowLimitsState,
  ratePerMinute: number,
  now = Date.now(),
): { ok: true } | { ok: false; reason: "rate_limited" } {
  if (now - state.window_started > 60_000) {
    state.window_started = now;
    state.window_count = 0;
  }
  if (state.window_count >= ratePerMinute) {
    return { ok: false, reason: "rate_limited" };
  }
  state.window_count += 1;
  return { ok: true };
}

export function checkDailyCost(
  state: ShadowLimitsState,
  maxUsd: number,
  addUsd: number,
  now = new Date(),
): { ok: true } | { ok: false; reason: "daily_cost_exceeded" } {
  const key = dayKey(now);
  if (state.day_key !== key) {
    state.day_key = key;
    state.day_cost_usd = 0;
  }
  if (state.day_cost_usd + addUsd > maxUsd) {
    return { ok: false, reason: "daily_cost_exceeded" };
  }
  state.day_cost_usd += addUsd;
  return { ok: true };
}

export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("shadow_timeout")), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
