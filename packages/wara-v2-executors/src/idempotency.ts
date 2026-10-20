import { createHash } from "node:crypto";
import { V2_DEFAULTS } from "@wara-v2/contracts";

/** Idempotency key estable: operación + versión + efecto + fingerprint. */
export function buildEffectIdempotencyKey(input: {
  operationId: string;
  operationVersion: number;
  effect: string;
  payloadHash: string;
}): string {
  const raw = [
    input.operationId,
    String(input.operationVersion),
    input.effect,
    input.payloadHash,
  ].join("|");
  return createHash("sha256").update(raw).digest("hex");
}

export function requestFingerprint(body: unknown): string {
  const canonical = JSON.stringify(sortKeys(body));
  return createHash("sha256").update(canonical).digest("hex");
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(obj).sort()) {
      // Never fingerprint secrets
      if (/token|password|secret|authorization|api[_-]?key/i.test(k)) continue;
      out[k] = sortKeys(obj[k]);
    }
    return out;
  }
  return value;
}

export function backoffMs(attemptNo: number): number {
  const table = V2_DEFAULTS.ATTEMPT_BACKOFF_MS;
  const idx = Math.max(0, Math.min(attemptNo - 1, table.length - 1));
  return table[idx]!;
}

export function maxAttempts(): number {
  return V2_DEFAULTS.OPERATION_MAX_ATTEMPTS;
}
