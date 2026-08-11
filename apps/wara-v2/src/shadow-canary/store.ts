/**
 * Store sanitizado 10A — idempotencia + evidencia sin PII cruda.
 * Retención 30 días bajo .local-data/shadow-canary/
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  unlinkSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const HERE = dirname(fileURLToPath(import.meta.url));
export const SHADOW_STORE_ROOT = join(
  HERE,
  "../../.local-data/shadow-canary",
);

export type ShadowRecord = {
  schema_version: 1;
  message_id: string;
  message_id_hash: string;
  tenant_synth: string;
  conversation_synth: string;
  phone_masked: string;
  at: string;
  expires_at: string;
  v1_outcome_sanitized?: Record<string, unknown>;
  v2_proposal: {
    intent?: string;
    missing_fields?: string[];
    clarify?: string;
    hypothetical_transition?: string;
    hypothetical_reply?: string;
  };
  policy: { blockReasons: string[] };
  latency_ms: number;
  tokens_est: number;
  cost_usd_est: number;
  error?: string;
  effects: {
    operations: 0;
    attempts: 0;
    outbox: 0;
    deliveries: 0;
    whatsapp_sends: 0;
  };
  /** Nunca golden automático de V1 */
  human_expected?: null;
};

function ensureStore(): void {
  mkdirSync(join(SHADOW_STORE_ROOT, "records"), { recursive: true });
  mkdirSync(join(SHADOW_STORE_ROOT, "idempotency"), { recursive: true });
}

export function messageIdHash(messageId: string): string {
  return createHash("sha256").update(messageId, "utf8").digest("hex");
}

export function hasProcessedMessage(messageId: string): boolean {
  ensureStore();
  const p = join(
    SHADOW_STORE_ROOT,
    "idempotency",
    `${messageIdHash(messageId)}.done`,
  );
  return existsSync(p);
}

export function markProcessed(messageId: string): void {
  ensureStore();
  const p = join(
    SHADOW_STORE_ROOT,
    "idempotency",
    `${messageIdHash(messageId)}.done`,
  );
  writeFileSync(p, new Date().toISOString());
}

export function saveShadowRecord(rec: ShadowRecord): string {
  ensureStore();
  const name = `${rec.message_id_hash}.json`;
  const path = join(SHADOW_STORE_ROOT, "records", name);
  writeFileSync(path, JSON.stringify(rec, null, 2));
  markProcessed(rec.message_id);
  return path;
}

export function loadShadowRecord(
  messageId: string,
): ShadowRecord | null {
  const path = join(
    SHADOW_STORE_ROOT,
    "records",
    `${messageIdHash(messageId)}.json`,
  );
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as ShadowRecord;
}

/** Purga registros vencidos (> retentionDays). */
export function purgeExpiredRecords(retentionDays = 30, now = Date.now()): number {
  ensureStore();
  const dir = join(SHADOW_STORE_ROOT, "records");
  let n = 0;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    const full = join(dir, f);
    try {
      const rec = JSON.parse(readFileSync(full, "utf8")) as ShadowRecord;
      if (Date.parse(rec.expires_at) < now) {
        unlinkSync(full);
        n += 1;
      }
    } catch {
      // ignore corrupt
    }
  }
  return n;
}

export function resetShadowStoreForTests(): void {
  ensureStore();
  for (const sub of ["records", "idempotency"] as const) {
    const dir = join(SHADOW_STORE_ROOT, sub);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      unlinkSync(join(dir, f));
    }
  }
}

export function storeStats(): { records: number; idempotency: number } {
  ensureStore();
  return {
    records: readdirSync(join(SHADOW_STORE_ROOT, "records")).length,
    idempotency: readdirSync(join(SHADOW_STORE_ROOT, "idempotency")).length,
  };
}
