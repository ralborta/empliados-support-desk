/** Circuit breaker simple (local). */
export class CircuitBreaker {
  private failures = 0;
  private openedAt: number | null = null;

  constructor(
    private readonly threshold = 5,
    private readonly coolDownMs = 30_000,
  ) {}

  assertClosed(): void {
    if (this.openedAt != null) {
      if (Date.now() - this.openedAt < this.coolDownMs) {
        throw new Error("circuit_open");
      }
      this.openedAt = null;
      this.failures = 0;
    }
  }

  success(): void {
    this.failures = 0;
    this.openedAt = null;
  }

  failure(): void {
    this.failures += 1;
    if (this.failures >= this.threshold) {
      this.openedAt = Date.now();
    }
  }

  get state(): "closed" | "open" {
    if (this.openedAt != null && Date.now() - this.openedAt < this.coolDownMs) {
      return "open";
    }
    return "closed";
  }
}

export class TokenBudget {
  private spent = 0;
  private costUsd = 0;

  constructor(
    private readonly maxTokens: number,
    private readonly maxCostUsd: number,
  ) {}

  assertWithin(nextTokens: number, nextCost: number): void {
    if (this.spent + nextTokens > this.maxTokens) {
      throw new Error("budget_tokens_exceeded");
    }
    if (this.costUsd + nextCost > this.maxCostUsd) {
      throw new Error("budget_cost_exceeded");
    }
  }

  record(tokens: number, cost: number): void {
    this.spent += tokens;
    this.costUsd += cost;
  }

  snapshot() {
    return { tokens: this.spent, cost_usd: this.costUsd };
  }
}

/** Estimación grosera gpt-4o-mini USD. */
export function estimateCostUsd(inputTokens: number, outputTokens: number): number {
  return (inputTokens * 0.15 + outputTokens * 0.6) / 1_000_000;
}
