import type { TurnInterpretation } from "../types/interpretation.js";
import {
  ThreadRelationSchema,
  UserActSchema,
  TurnInterpretationSchema,
} from "../types/interpretation.js";

const USER_ACTS = new Set(UserActSchema.options);
const RELATIONS = new Set(ThreadRelationSchema.options);
const OPERATION_HINTS = new Set([
  "conversation",
  "read",
  "write",
  "handoff",
]);

function coerceEntities(value: unknown): Record<string, unknown> {
  if (value == null) return {};
  if (Array.isArray(value)) {
    const merged: Record<string, unknown> = {};
    for (const item of value) {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        Object.assign(merged, item as Record<string, unknown>);
      }
    }
    return merged;
  }
  if (typeof value === "object") {
    return value as Record<string, unknown>;
  }
  return {};
}

function coerceOperationHint(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const norm = value.trim().toLowerCase();
  if (OPERATION_HINTS.has(norm)) return norm;
  if (
    norm === "query" ||
    norm === "consult" ||
    norm === "consulta" ||
    norm === "status" ||
    norm === "lookup"
  ) {
    return "read";
  }
  if (norm === "chat" || norm === "talk") return "conversation";
  if (norm === "create" || norm === "update" || norm === "submit") return "write";
  return undefined;
}

/** Normalización estructural previa a Zod (no decide conversación). */
export function coerceInterpretationRaw(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const o = { ...(raw as Record<string, unknown>) };

  if (!USER_ACTS.has(o.userAct as never)) {
    o.userAct = "unknown";
  }
  if (!RELATIONS.has(o.relation as never)) {
    o.relation = "ambiguous";
  }

  if (!Array.isArray(o.requests)) o.requests = [];
  if (!Array.isArray(o.references)) o.references = [];
  if (!Array.isArray(o.corrections)) o.corrections = [];

  o.requests = (o.requests as unknown[])
    .filter((r) => r && typeof r === "object")
    .map((r) => {
      const req = { ...(r as Record<string, unknown>) };
      if (typeof req.goal !== "string" || !req.goal.trim()) {
        req.goal = String(req.domain ?? req.serviceId ?? "consulta").slice(0, 400);
      }
      req.entities = coerceEntities(req.entities);
      const hint = coerceOperationHint(req.operationHint);
      if (hint) req.operationHint = hint;
      else delete req.operationHint;
      return req;
    });

  if (typeof o.normalizedMeaning !== "string" || !o.normalizedMeaning.trim()) {
    o.normalizedMeaning = "Mensaje del usuario";
  }

  if (typeof o.confidence !== "number" || Number.isNaN(o.confidence)) {
    o.confidence = 0.5;
  }
  o.confidence = Math.min(1, Math.max(0, o.confidence));

  if (typeof o.answersExpectedField !== "boolean") {
    o.answersExpectedField = false;
  }

  return o;
}

export function parseInterpretation(raw: unknown): {
  ok: true;
  data: TurnInterpretation;
} | {
  ok: false;
  coerced: unknown;
  schemaErrors: string[];
} {
  const coerced = coerceInterpretationRaw(raw);
  const parsed = TurnInterpretationSchema.safeParse(coerced);
  if (parsed.success) {
    return { ok: true, data: parsed.data };
  }
  return {
    ok: false,
    coerced,
    schemaErrors: parsed.error.issues.map((i) => {
      const path = i.path.length ? i.path.join(".") : "(root)";
      return `${path}: ${i.message}`;
    }),
  };
}
