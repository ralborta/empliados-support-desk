/**
 * Shadow canary in-process (V1/Next) — evaluation-only, cero efectos.
 * Duplica barreras 10A sin depender del paquete @wara-v2/app en el bundle.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const E164_RE = /^\+[1-9]\d{6,14}$/;

function isTrue(v: string | undefined): boolean {
  return v === "true" || v === "1";
}

function parseAllowlist(raw: string): string[] {
  const t = raw.trim();
  if (!t) return [];
  if (t.includes("*")) throw new Error("allowlist_wildcard_forbidden");
  return t
    .split(/[,\s]+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .filter((p) => E164_RE.test(p));
}

function maskPhone(phone: string): string {
  if (phone.length < 8) return "+***";
  return `${phone.slice(0, 6)}****${phone.slice(-4)}`;
}

function scrub(text: string): string {
  let t = text;
  t = t.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[EMAIL]");
  t = t.replace(
    /(?:\+|00)(?:54)?[\s-]?(?:9)?[\s-]?\d{2,4}[\s-]?\d{6,8}\b|\b0\d{2,4}[\s-]?\d{6,8}\b/g,
    "[TEL]",
  );
  t = t.replace(/https?:\/\/[^\s]+/gi, "[URL]");
  t = t.replace(/\b[A-Z]{2}\d{3}[A-Z]{2}\b|\b[A-Z]{3}\d{3}\b/gi, "[PLATE]");
  return t.trim();
}

function guessIntent(text: string): string {
  const s = text.toLowerCase();
  if (/od[oó]metro|hor[oó]metro|km\b/.test(s)) return "update_odometer";
  if (/certificado/.test(s)) return "issue_certificate";
  if (/mantenimiento/.test(s)) return "create_maintenance";
  if (/unidad|estado/.test(s)) return "unit_status";
  if (/qu[eé] pod[eé]s|ayuda|capacidades/.test(s)) return "list_capabilities";
  if (s.length < 8) return "clarify";
  return "none";
}

const processed = new Set<string>();

function storeDir(): string | null {
  try {
    const dir = join(process.cwd(), "apps/wara-v2/.local-data/shadow-canary/records");
    mkdirSync(dir, { recursive: true });
    mkdirSync(join(dir, "..", "idempotency"), { recursive: true });
    return dir;
  } catch {
    return null;
  }
}

export type InProcessShadowInput = {
  phone_e164: string;
  text: string;
  message_id: string;
  tenant_id?: string;
  has_attachment?: boolean;
  v1_outcome_code?: string;
};

export type InProcessShadowResult = {
  accepted: boolean;
  reason: string;
  effects: {
    operations: 0;
    attempts: 0;
    outbox: 0;
    deliveries: 0;
    whatsapp_sends: 0;
  };
};

/**
 * Evaluación shadow canary. Nunca envía WhatsApp ni escribe ops.
 */
export async function runShadowCanaryInProcess(
  input: InProcessShadowInput,
): Promise<InProcessShadowResult> {
  const zero = {
    operations: 0 as const,
    attempts: 0 as const,
    outbox: 0 as const,
    deliveries: 0 as const,
    whatsapp_sends: 0 as const,
  };

  try {
    if (isTrue(process.env.WARA_V2_SHADOW_KILL)) {
      return { accepted: false, reason: "kill_switch", effects: zero };
    }
    if (!isTrue(process.env.WARA_V2_SHADOW)) {
      return { accepted: false, reason: "shadow_off", effects: zero };
    }
    if (!isTrue(process.env.WARA_V2_SHADOW_CANARY)) {
      return { accepted: false, reason: "canary_off", effects: zero };
    }
    if (isTrue(process.env.DELIVERY_ENABLED)) {
      return { accepted: false, reason: "shadow_incompatible_with_delivery", effects: zero };
    }
    if (!isTrue(process.env.EVALUATION_ONLY)) {
      return { accepted: false, reason: "evaluation_only_required", effects: zero };
    }
    if (input.has_attachment) {
      return { accepted: false, reason: "attachments_excluded", effects: zero };
    }

    const tenant =
      process.env.WARA_V2_SHADOW_TENANT?.trim() || "tenant_internal_ops";
    if ((input.tenant_id || tenant) !== tenant) {
      return { accepted: false, reason: "tenant_not_allowlisted", effects: zero };
    }

    let allowlist: string[];
    try {
      allowlist = parseAllowlist(process.env.WARA_V2_SHADOW_ALLOWLIST ?? "");
    } catch {
      return { accepted: false, reason: "allowlist_invalid", effects: zero };
    }
    if (allowlist.length === 0) {
      return { accepted: false, reason: "allowlist_empty", effects: zero };
    }
    if (!allowlist.includes(input.phone_e164)) {
      return { accepted: false, reason: "phone_not_allowlisted", effects: zero };
    }

    const idHash = createHash("sha256")
      .update(input.message_id)
      .digest("hex");
    if (processed.has(idHash)) {
      return { accepted: false, reason: "duplicate_skipped", effects: zero };
    }
    const dir = storeDir();
    if (dir) {
      const done = join(dir, "..", "idempotency", `${idHash}.done`);
      if (existsSync(done)) {
        return { accepted: false, reason: "duplicate_skipped", effects: zero };
      }
    }

    const cleaned = scrub(input.text);
    if (!cleaned) {
      return { accepted: false, reason: "empty_text", effects: zero };
    }

    const intent = guessIntent(cleaned);
    const expires = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
    const record = {
      schema_version: 1,
      source: "in_process_v1",
      message_id_hash: idHash,
      phone_masked: maskPhone(input.phone_e164),
      at: new Date().toISOString(),
      expires_at: expires,
      v1_outcome_sanitized: input.v1_outcome_code
        ? { outcome_code: input.v1_outcome_code }
        : undefined,
      v2_proposal: {
        intent,
        missing_fields: intent === "clarify" ? ["unidad", "valor"] : [],
        clarify: intent === "clarify" ? "¿Podés dar más detalle?" : undefined,
        hypothetical_transition: "none_evaluation_only",
        hypothetical_reply: `Evaluación shadow: intención hipotética ${intent}`,
      },
      policy: { blockReasons: [] },
      latency_ms: 0,
      tokens_est: 0,
      cost_usd_est: 0,
      effects: zero,
      human_expected: null,
    };

    processed.add(idHash);
    if (dir) {
      writeFileSync(join(dir, `${idHash}.json`), JSON.stringify(record, null, 2));
      writeFileSync(
        join(dir, "..", "idempotency", `${idHash}.done`),
        new Date().toISOString(),
      );
    }

    return { accepted: true, reason: "evaluated", effects: zero };
  } catch {
    return {
      accepted: false,
      reason: "shadow_internal_error",
      effects: {
        operations: 0,
        attempts: 0,
        outbox: 0,
        deliveries: 0,
        whatsapp_sends: 0,
      },
    };
  }
}
