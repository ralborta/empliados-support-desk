import type { CleanRuntimeConfig } from "../../config/clean-config.js";
import { DeterministicComposer } from "../../core/response/deterministic-composer.js";
import type { Composer } from "../../core/ports/ports.js";
import type { ComposerInput } from "../../core/types/response.js";

export const CLEAN_COMPOSER_PROMPT_VERSION = "clean-composer-facts-only-1";
export type ComposerStyleEnvelope = Readonly<{ opening?: string; factOrder: readonly string[]; closing?: string }>;
export interface ComposerLlmTransport {
  compose(input: Readonly<{
    promptVersion: string; purpose: ComposerInput["responsePlan"]["purpose"];
    facts: readonly Readonly<{ code: string; text: string }>[]; nextQuestion: string | null;
    pendingTaskReminder: string | null; protectedBlocks: readonly string[];
    visibleState: Readonly<{ hasCompany: boolean; hasUnit: boolean; focusedTaskType: string | null }>;
    style: "friendly_rioplatense_concise"; customerName?: string;
  }>): Promise<ComposerStyleEnvelope>;
}

function safeName(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const clean = [...value].filter((char) => char === " " || char === "'" || char === "-" || char.toLocaleUpperCase() !== char.toLocaleLowerCase()).join("").trim().slice(0, 60);
  return clean || undefined;
}
function safeStyle(value: string | undefined): string | null {
  if (value === undefined) return "";
  if (value.length > 100) return null;
  for (const char of value) if (char === "\n" || char === "\r" || char === "<" || char === ">") return null;
  return value.trim();
}

export class FactsOnlyLlmComposer implements Composer {
  private readonly fallback = new DeterministicComposer();
  constructor(private readonly config: CleanRuntimeConfig, private readonly transport: ComposerLlmTransport) {}
  async compose(input: ComposerInput): Promise<string> {
    if (!this.config.runtimeEnabled || !this.config.llmEnabled || input.responsePlan.facts.some((fact) => !fact.verified)) return this.fallback.compose(input);
    const facts = input.responsePlan.facts.map(({ code, text }) => ({ code, text }));
    try {
      const envelope = await this.transport.compose({
        promptVersion: CLEAN_COMPOSER_PROMPT_VERSION, purpose: input.responsePlan.purpose, facts,
        nextQuestion: input.responsePlan.nextQuestion, pendingTaskReminder: input.responsePlan.pendingTaskReminder,
        protectedBlocks: input.responsePlan.protectedBlocks,
        visibleState: { hasCompany: Boolean(input.state.company), hasUnit: Boolean(input.state.unit), focusedTaskType: input.state.tasks.find((task) => task.id === input.state.focusedTaskId)?.type ?? null },
        style: "friendly_rioplatense_concise", customerName: safeName(input.customerName),
      });
      const opening = safeStyle(envelope.opening); const closing = safeStyle(envelope.closing);
      if (opening === null || closing === null || envelope.factOrder.length !== facts.length || new Set(envelope.factOrder).size !== facts.length) return this.fallback.compose(input);
      const byCode = new Map(facts.map((fact) => [fact.code, fact.text]));
      if (envelope.factOrder.some((code) => !byCode.has(code))) return this.fallback.compose(input);
      const lines = [opening, ...envelope.factOrder.map((code) => byCode.get(code)!), input.responsePlan.pendingTaskReminder, input.responsePlan.nextQuestion, ...input.responsePlan.protectedBlocks, closing].filter((value): value is string => Boolean(value));
      const reply = lines.join("\n").trim();
      return reply || this.fallback.compose(input);
    } catch { return this.fallback.compose(input); }
  }
}
