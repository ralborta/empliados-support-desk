/**
 * Adaptadores de modelo locales Fase 7 — sin SDK LLM, sin HTTP, sin API keys.
 */
import type { ModelAdapter } from "@wara-v2/orchestrator";
import {
  FakeModelAdapter,
  FailingModelAdapter,
  InvalidJsonModelAdapter,
} from "@wara-v2/orchestrator";

export {
  FakeModelAdapter,
  FailingModelAdapter,
  InvalidJsonModelAdapter,
};

/** Scripted: secuencia fija de decisiones. */
export class ScriptedModelAdapter implements ModelAdapter {
  readonly name = "scripted-model";
  private i = 0;
  constructor(private readonly scripts: unknown[]) {}
  async decide(): Promise<unknown> {
    const v = this.scripts[this.i] ?? this.scripts[this.scripts.length - 1];
    this.i += 1;
    return v;
  }
}

export class TimeoutModelAdapter implements ModelAdapter {
  readonly name = "timeout-model";
  constructor(private readonly ms = 50) {}
  async decide(): Promise<unknown> {
    await new Promise((r) => setTimeout(r, this.ms));
    throw new Error("model_timeout");
  }
}

/**
 * Stub estructural para futuro LLM — no importable como activo.
 * No realiza HTTP, no lee API keys, no se habilita por env simple.
 */
export const FutureLlmAdapterStub = {
  name: "future-llm-stub",
  enabled: false as const,
  note: "Fase 8+ only with explicit authorization; no SDK bundled",
} as const;

export function assertNoRealModel(): void {
  if (process.env.REAL_MODEL_ENABLED === "true") {
    throw new Error("REAL_MODEL_ENABLED_forbidden_in_phase7");
  }
  if (FutureLlmAdapterStub.enabled) {
    throw new Error("future_llm_must_stay_disabled");
  }
}
