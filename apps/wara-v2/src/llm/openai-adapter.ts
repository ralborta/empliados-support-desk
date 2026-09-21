/**
 * Adaptador OpenAI real — Structured Outputs strict + snapshot oficial.
 * FakeModelAdapter permanece el default del runtime.
 */
import type { ModelAdapter, TurnContext } from "@wara-v2/orchestrator";
import {
  parseLlmProposal,
  LLM_PROPOSAL_OPENAI_JSON_SCHEMA,
  normalizeOpenAiProposal,
} from "@wara-v2/contracts";
import {
  FIXED_OPENAI_ENDPOINT,
  loadPhase8LlmActivation,
  type Phase8LlmActivation,
} from "./flags.js";
import { authorizedOpenAiFetch } from "./network.js";
import { buildSanitizedMessages, hashPromptParts } from "./sanitize.js";
import { proposalToOrchestratorDecision } from "./map-proposal.js";
import { CircuitBreaker, TokenBudget, estimateCostUsd } from "./circuit.js";
import { classifyLlmError } from "./classify.js";

export type LlmCallMetrics = {
  fixture_hash: string;
  tenant_id: string;
  model: string;
  contract_version: 1;
  latency_ms: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd_est: number;
  validation: "ok" | string;
  correlation_id?: string;
  prompt_hash: string;
  response_format: "json_schema_strict";
};

export type OpenAiAdapterOpts = {
  activation?: Phase8LlmActivation;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
  budget?: TokenBudget;
  breaker?: CircuitBreaker;
  onMetrics?: (m: LlmCallMetrics) => void;
  mockProviderBody?: unknown;
  buildMessages?: (ctx: TurnContext) => {
    system: string;
    user: string;
    fixtureHash: string;
  };
};

export class OpenAiChatAdapter implements ModelAdapter {
  readonly name = "openai-chat-real";
  readonly real = true as const;
  private readonly activation: Phase8LlmActivation;
  private readonly breaker: CircuitBreaker;
  private readonly budget: TokenBudget;
  private inflight = 0;
  private readonly maxConcurrent = 2;

  constructor(private readonly opts: OpenAiAdapterOpts = {}) {
    this.activation = opts.activation ?? loadPhase8LlmActivation();
    this.breaker = opts.breaker ?? new CircuitBreaker();
    this.budget = opts.budget ?? new TokenBudget(50_000, 0.5);
  }

  async decide(context: TurnContext): Promise<unknown> {
    if (this.inflight >= this.maxConcurrent) {
      throw new Error("llm_concurrency_limit");
    }
    this.breaker.assertClosed();
    this.inflight += 1;
    const started = Date.now();
    const { system, user, fixtureHash } = (
      this.opts.buildMessages ?? buildSanitizedMessages
    )(context);
    const promptHash = hashPromptParts(system, user);

    try {
      let content: string;
      let inputTokens = 0;
      let outputTokens = 0;

      if (this.opts.mockProviderBody !== undefined) {
        content = JSON.stringify(this.opts.mockProviderBody);
      } else {
        const body = {
          model: this.activation.model,
          temperature: 0,
          max_tokens: 800,
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "llm_proposal_v1",
              strict: true,
              schema: LLM_PROPOSAL_OPENAI_JSON_SCHEMA,
            },
          },
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        };
        const bodyStr = JSON.stringify(body);
        if (bodyStr.length > 32_000) throw new Error("llm_payload_too_large");

        let lastErr: unknown;
        const maxRetries = this.opts.maxRetries ?? 1;
        let attempt = 0;
        let result: { status: number; text: string } | null = null;
        while (attempt <= maxRetries) {
          try {
            result = await authorizedOpenAiFetch(FIXED_OPENAI_ENDPOINT, {
              method: "POST",
              headers: {
                "content-type": "application/json",
                authorization: `Bearer ${this.activation.apiKey}`,
              },
              body: bodyStr,
              timeoutMs: this.opts.timeoutMs ?? 20_000,
              fetchImpl: this.opts.fetchImpl,
            });
            if (result.status === 429 || result.status >= 500) {
              lastErr = new Error(
                result.status === 429 ? "rate_limit" : `transient_${result.status}`,
              );
              attempt += 1;
              continue;
            }
            break;
          } catch (e) {
            lastErr = e;
            const cls = classifyLlmError(e);
            if (
              cls === "timeout_before_response" ||
              cls === "connection_interrupted"
            ) {
              attempt += 1;
              continue;
            }
            throw e;
          }
        }
        if (!result) throw lastErr ?? new Error("llm_no_response");
        if (result.status === 429) throw new Error("rate_limit");
        if (result.status >= 400) {
          throw new Error(`permanent_http_${result.status}`);
        }

        let parsedProvider: {
          choices?: Array<{
            message?: { content?: string | null; refusal?: string | null };
            finish_reason?: string;
          }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        try {
          parsedProvider = JSON.parse(result.text) as typeof parsedProvider;
        } catch {
          throw new Error("llm_result_malformed_json:provider_envelope");
        }
        const choice = parsedProvider.choices?.[0];
        if (choice?.message?.refusal) {
          throw new Error("model_refusal");
        }
        if (choice?.finish_reason === "length") {
          throw new Error("truncated_response");
        }
        content = choice?.message?.content ?? "";
        if (!content || !content.trim()) throw new Error("empty_response");
        inputTokens = parsedProvider.usage?.prompt_tokens ?? 0;
        outputTokens = parsedProvider.usage?.completion_tokens ?? 0;
      }

      let json: unknown;
      try {
        json = JSON.parse(content);
      } catch {
        throw new Error("llm_result_malformed_json:content");
      }

      // Rechazo adicional vía schema interno LlmProposal (no reparación silenciosa)
      const proposal = parseLlmProposal(normalizeOpenAiProposal(json));
      const decision = proposalToOrchestratorDecision(proposal);
      const cost = estimateCostUsd(inputTokens || 200, outputTokens || 100);
      this.budget.assertWithin(inputTokens + outputTokens || 300, cost);
      this.budget.record(inputTokens || 200, cost);
      this.breaker.success();

      this.opts.onMetrics?.({
        fixture_hash: fixtureHash,
        tenant_id: context.conversation.activeCompanyId ?? "unknown",
        model: this.activation.model,
        contract_version: 1,
        latency_ms: Date.now() - started,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cost_usd_est: cost,
        validation: "ok",
        prompt_hash: promptHash,
        response_format: "json_schema_strict",
      });

      return decision;
    } catch (e) {
      this.breaker.failure();
      const cls = classifyLlmError(e);
      this.opts.onMetrics?.({
        fixture_hash: fixtureHash,
        tenant_id: context.conversation.activeCompanyId ?? "unknown",
        model: this.activation.model,
        contract_version: 1,
        latency_ms: Date.now() - started,
        input_tokens: 0,
        output_tokens: 0,
        cost_usd_est: 0,
        validation: cls,
        prompt_hash: promptHash,
        response_format: "json_schema_strict",
      });
      throw e;
    } finally {
      this.inflight -= 1;
    }
  }
}

export function tryCreateOpenAiAdapter(
  opts?: OpenAiAdapterOpts,
): OpenAiChatAdapter {
  const activation = opts?.activation ?? loadPhase8LlmActivation();
  return new OpenAiChatAdapter({ ...opts, activation });
}
