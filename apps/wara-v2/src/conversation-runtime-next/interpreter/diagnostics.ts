import type { ZodError } from "zod";

export type InterpreterFailureKind =
  | "api_error"
  | "timeout"
  | "rate_limit"
  | "empty_response"
  | "invalid_json"
  | "schema_validation_failed"
  | "unsupported_response_format"
  | "model_not_found"
  | "context_too_large"
  | "unknown_error";

export type InterpreterAttemptKind = "primary" | "repair";

export type InterpreterAttemptDiagnostic = {
  attempt: number;
  kind: InterpreterAttemptKind;
  startedAt: string;
  finishedAt: string;
  latencyMs: number;
  httpStatus?: number;
  failureKind?: InterpreterFailureKind;
  safeErrorMessage?: string;
  timedOut: boolean;
  rawSanitized?: unknown;
  schemaErrors?: string[];
};

export type InterpreterDiagnostic = {
  model: string;
  promptVersion: string;
  systemPromptChars: number;
  userPayloadChars: number;
  serviceRegistryCount: number;
  startedAt: string;
  finishedAt: string;
  latencyMs: number;
  attempts: InterpreterAttemptDiagnostic[];
  finalFailureKind: InterpreterFailureKind | null;
  fallbackReason: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
};

const SENSITIVE_PATTERNS = [
  /sk-[a-zA-Z0-9_-]{10,}/g,
  /Bearer\s+[a-zA-Z0-9._-]+/gi,
  /authorization["']?\s*:\s*["'][^"']+["']/gi,
];

export function sanitizeForTrace(text: string, maxLen = 800): string {
  let s = text;
  for (const p of SENSITIVE_PATTERNS) {
    s = s.replace(p, "[redacted]");
  }
  if (s.length > maxLen) return s.slice(0, maxLen) + "…";
  return s;
}

export function sanitizeRawOutput(raw: unknown, maxLen = 1200): unknown {
  if (raw == null) return null;
  if (typeof raw === "string") return sanitizeForTrace(raw, maxLen);
  try {
    const s = JSON.stringify(raw);
    if (s.length <= maxLen) return raw;
    return JSON.parse(sanitizeForTrace(s, maxLen));
  } catch {
    return sanitizeForTrace(String(raw), maxLen);
  }
}

export function formatSchemaErrors(error: ZodError, max = 12): string[] {
  return error.issues.slice(0, max).map((i) => {
    const path = i.path.length ? i.path.join(".") : "(root)";
    return `${path}: ${i.message}`;
  });
}

export function classifyHttpFailure(status: number, bodyText: string): InterpreterFailureKind {
  if (status === 429) return "rate_limit";
  if (status === 404) return "model_not_found";
  if (status === 413) return "context_too_large";
  if (status >= 400) return "api_error";
  const lower = bodyText.toLowerCase();
  if (lower.includes("context length") || lower.includes("maximum context")) {
    return "context_too_large";
  }
  if (lower.includes("rate limit") || lower.includes("rate_limit")) {
    return "rate_limit";
  }
  return "api_error";
}

export function classifyThrownError(message: string): InterpreterFailureKind {
  const m = message.toLowerCase();
  if (message === "llm_timeout" || m.includes("timeout") || m.includes("abort")) {
    return "timeout";
  }
  if (message === "llm_credential_missing") return "api_error";
  if (m.includes("rate limit")) return "rate_limit";
  return "unknown_error";
}

export function classifyErrorCode(code: string): InterpreterFailureKind {
  if (code === "json_parse_failed") return "invalid_json";
  if (code.startsWith("schema_invalid")) return "schema_validation_failed";
  if (code.startsWith("http_")) return "api_error";
  if (code === "empty_response") return "empty_response";
  return classifyThrownError(code);
}
