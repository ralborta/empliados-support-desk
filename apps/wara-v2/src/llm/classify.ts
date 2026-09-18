/**
 * Clasificación de resultados LLM + fallback fail-closed.
 */
export type LlmResultClass =
  | "valid"
  | "schema_invalid"
  | "malformed_json"
  | "unknown_version"
  | "forbidden_fields"
  | "timeout_before_response"
  | "connection_interrupted"
  | "rate_limit"
  | "transient_error"
  | "permanent_error"
  | "empty_response"
  | "truncated_response"
  | "model_refusal"
  | "unsafe_content"
  | "contradictory"
  | "low_confidence"
  | "circuit_open"
  | "budget_exceeded"
  | "activation_denied";

export type FallbackAction =
  | "clarify_simulated"
  | "keep_state"
  | "harness_review"
  | "use_fake_declared";

export function classifyLlmError(err: unknown): LlmResultClass {
  const msg = err instanceof Error ? err.message : String(err);
  if (/activation|flag_|provider_not|model_not|endpoint_|database_not|bind_host|credential/.test(msg)) {
    return "activation_denied";
  }
  if (/circuit_open/.test(msg)) return "circuit_open";
  if (/budget/.test(msg)) return "budget_exceeded";
  if (/llm_timeout|AbortError/.test(msg)) return "timeout_before_response";
  if (/rate.?limit|429/.test(msg)) return "rate_limit";
  if (/malformed_json|JSON/.test(msg)) return "malformed_json";
  if (/unknown_version|contract_version/.test(msg)) return "unknown_version";
  if (/forbidden_key|forbidden_fields/.test(msg)) return "forbidden_fields";
  if (/schema_invalid/.test(msg)) return "schema_invalid";
  if (/empty/.test(msg)) return "empty_response";
  if (/truncat/.test(msg)) return "truncated_response";
  if (/refus|content_filter|unsafe/.test(msg)) return "unsafe_content";
  if (/ECONNRESET|fetch failed|network/.test(msg)) return "connection_interrupted";
  if (/5\d\d|transient/.test(msg)) return "transient_error";
  if (/4\d\d|permanent/.test(msg)) return "permanent_error";
  return "permanent_error";
}

/**
 * Fallback permitido — nunca cambia el significado de una operación en silencio.
 */
export function chooseFallback(
  cls: LlmResultClass,
  opts?: { allowFake?: boolean },
): FallbackAction {
  if (cls === "low_confidence" || cls === "contradictory" || cls === "schema_invalid") {
    return "clarify_simulated";
  }
  if (cls === "timeout_before_response" || cls === "transient_error" || cls === "rate_limit") {
    return "keep_state";
  }
  if (opts?.allowFake) return "use_fake_declared";
  if (cls === "activation_denied" || cls === "circuit_open" || cls === "budget_exceeded") {
    return "harness_review";
  }
  return "keep_state";
}

/** Respuesta de aclaración simulada (sin efectos). */
export function clarifyDecisionStub(summary: string) {
  return {
    schemaVersion: 2 as const,
    interpretationSummary: summary.slice(0, 500),
    proposedGoal: "clarify" as const,
    acts: [
      {
        act_id: "a_clarify",
        type: "unclear" as const,
        order: 0,
        priority: 10,
        blocking: true,
        depends_on: [] as string[],
        conflicts_with: [] as string[],
        expected_effect: "clarify" as const,
        confidence: 0.4,
      },
    ],
    responseHints: { mustNotClaimExecution: true, mustAsk: ["¿Podés reformular?"] },
  };
}
