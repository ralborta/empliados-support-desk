import type { OperationalFact } from "../../core/types/response.js";

export type NormalizedServiceResult<T> =
  | Readonly<{ status: "success"; data: T; facts: readonly OperationalFact[] }>
  | Readonly<{ status: "pending"; data?: T; facts: readonly OperationalFact[] }>
  | Readonly<{ status: "not_found"; facts: readonly OperationalFact[] }>
  | Readonly<{ status: "rejected"; code?: string; facts: readonly OperationalFact[] }>
  | Readonly<{ status: "conflict"; code?: string; facts: readonly OperationalFact[] }>
  | Readonly<{ status: "unauthorized"; facts: readonly OperationalFact[] }>
  | Readonly<{ status: "validation_error"; errors: readonly string[] }>
  | Readonly<{ status: "backend_error"; safeError: string }>
  | Readonly<{ status: "timeout"; safeError: string }>;

type TechnicalResponse = Readonly<{
  ok?: unknown; status?: unknown; statusCode?: unknown; code?: unknown; data?: unknown;
  errors?: unknown; reference?: unknown; ticketId?: unknown; assignedTo?: unknown;
}>;

function technicalRecord(raw: unknown): TechnicalResponse | null {
  return raw !== null && typeof raw === "object" && !Array.isArray(raw) ? raw as TechnicalResponse : null;
}
function safeCode(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= 80 ? value : undefined;
}
function verifiedFacts(raw: TechnicalResponse): readonly OperationalFact[] {
  const fields: Array<[string, unknown]> = [["service.reference", raw.reference], ["ticket.id", raw.ticketId], ["conversation.assigned_to", raw.assignedTo]];
  return fields.flatMap(([code, value]) => typeof value === "string" || typeof value === "number"
    ? [{ code, source: "capability" as const, text: String(value), verified: true }]
    : []);
}

export function normalizeServiceResponse<T = unknown>(rawInput: unknown): NormalizedServiceResult<T> {
  const raw = technicalRecord(rawInput);
  if (!raw) return { status: "backend_error", safeError: "invalid_backend_response" };
  const status = typeof raw.status === "string" ? raw.status.toLowerCase() : "";
  const statusCode = typeof raw.statusCode === "number" ? raw.statusCode : null;
  const facts = verifiedFacts(raw);
  const code = safeCode(raw.code);
  if (status === "timeout" || statusCode === 408 || statusCode === 504) return { status: "timeout", safeError: "service_timeout" };
  if (status === "pending" || statusCode === 202) return { status: "pending", ...(raw.data === undefined ? {} : { data: raw.data as T }), facts };
  if (status === "not_found" || statusCode === 404) return { status: "not_found", facts };
  if (status === "rejected" || statusCode === 422) return { status: "rejected", ...(code ? { code } : {}), facts };
  if (status === "conflict" || statusCode === 409) return { status: "conflict", ...(code ? { code } : {}), facts };
  if (status === "unauthorized" || statusCode === 401 || statusCode === 403) return { status: "unauthorized", facts };
  if (status === "validation_error" || statusCode === 400) {
    const errors = Array.isArray(raw.errors) ? raw.errors.filter((item): item is string => typeof item === "string") : [];
    return { status: "validation_error", errors: errors.length ? errors : ["invalid_request"] };
  }
  if (status === "backend_error" || (statusCode !== null && statusCode >= 500)) return { status: "backend_error", safeError: "service_unavailable" };
  if (raw.ok === true || status === "success" || (statusCode !== null && statusCode >= 200 && statusCode < 300)) {
    if (raw.data === undefined) return { status: "backend_error", safeError: "missing_success_data" };
    return { status: "success", data: raw.data as T, facts };
  }
  return { status: "backend_error", safeError: "unknown_backend_response" };
}
