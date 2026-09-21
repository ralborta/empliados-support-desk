import { createHash } from "node:crypto";

export type CleanIdentityKind = "decision" | "task" | "resolution" | "operation" | "message";

function encoded(value: string | number): string {
  const text = String(value);
  if (!text) throw new Error("CLEAN_IDENTITY_EMPTY_COMPONENT");
  return `${Buffer.byteLength(text, "utf8")}:${text}`;
}

export function stableCleanId(kind: CleanIdentityKind, components: readonly (string | number)[]): string {
  if (!components.length) throw new Error("CLEAN_IDENTITY_COMPONENTS_REQUIRED");
  const digest = createHash("sha256").update([kind, ...components].map(encoded).join("|")).digest("hex").slice(0, 32);
  return `clean-${kind}-${digest}`;
}

export function cleanDecisionId(input: Readonly<{ tenantId: string; conversationId: string; messageId: string }>): string {
  return stableCleanId("decision", [input.tenantId, input.conversationId, input.messageId]);
}

export function cleanChildId(input: Readonly<{ decisionId: string; kind: "task" | "resolution" | "operation"; discriminator: string; ordinal: number }>): string {
  if (!Number.isSafeInteger(input.ordinal) || input.ordinal < 0) throw new Error("CLEAN_IDENTITY_INVALID_ORDINAL");
  return stableCleanId(input.kind, [input.decisionId, input.discriminator, input.ordinal]);
}

function canonicalJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(",")}}`;
}

export function cleanPayloadHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
