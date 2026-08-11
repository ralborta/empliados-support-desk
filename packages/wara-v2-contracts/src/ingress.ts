/**
 * Contrato canónico de ingress V2 (Fase 7) — versionado, fail-closed.
 */
import { z } from "zod";

export const CANONICAL_INGRESS_SCHEMA_VERSION = 1 as const;

const AllowedMetadataKeySchema = z.enum([
  "locale",
  "channel_hint",
  "fixture_id",
  "replay_step",
  "shadow_source",
]);

export const CanonicalIngressSchema = z
  .object({
    schema_version: z.literal(CANONICAL_INGRESS_SCHEMA_VERSION),
    source: z.enum(["synthetic", "replay", "shadow", "local_harness"]),
    tenant_id: z.string().min(1).max(128),
    external_conversation_id: z.string().min(1).max(256),
    external_message_id: z.string().min(1).max(256),
    received_at: z.string().datetime({ offset: true }),
    message_type: z.enum(["text", "confirmation", "system"]),
    content: z.object({
      text: z.string().max(4000),
    }),
    metadata: z
      .record(z.string().max(64), z.string().max(256))
      .optional()
      .default({})
      .superRefine((meta, ctx) => {
        for (const key of Object.keys(meta)) {
          const ok = AllowedMetadataKeySchema.safeParse(key);
          if (!ok.success) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `metadata_key_not_allowed:${key}`,
            });
          }
        }
      }),
    correlation_id: z.string().uuid(),
    causation_id: z.string().uuid().optional(),
    is_replay: z.boolean().default(false),
    is_shadow: z.boolean().default(false),
  })
  .strict();

export type CanonicalIngress = z.infer<typeof CanonicalIngressSchema>;

const FORBIDDEN_KEYS = [
  "tool",
  "tools",
  "url",
  "callback",
  "commit",
  "password",
  "token",
  "api_key",
  "authorization",
  "__proto__",
  "constructor",
  "prototype",
];

export function assertNoForbiddenKeys(value: unknown, path = ""): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoForbiddenKeys(v, `${path}[${i}]`));
    return;
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const lower = k.toLowerCase();
    if (FORBIDDEN_KEYS.some((f) => lower === f || lower.includes(f))) {
      throw new Error(`forbidden_key:${path}.${k}`);
    }
    assertNoForbiddenKeys(v, path ? `${path}.${k}` : k);
  }
}

export function parseCanonicalIngress(raw: unknown): CanonicalIngress {
  assertNoForbiddenKeys(raw);
  const parsed = CanonicalIngressSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`ingress_schema_invalid:${parsed.error.issues[0]?.message ?? "unknown"}`);
  }
  return parsed.data;
}

/** Clave de aislamiento: siempre incluye tenant. */
export function tenantScopedKey(
  tenantId: string,
  externalConversationId: string,
): string {
  return `${tenantId}::${externalConversationId}`;
}

export function tenantScopedMessageKey(
  tenantId: string,
  externalMessageId: string,
): string {
  return `${tenantId}::${externalMessageId}`;
}
