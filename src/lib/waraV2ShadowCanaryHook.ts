/**
 * Hook V1 → copia shadow 10A (fire-and-forget HTTP loopback).
 * Fail-closed: sin flags no hace nada. Si el API V2 no corre, el fetch falla
 * en silencio y V1 continúa.
 *
 * Activación canary real requiere autorización explícita adicional.
 */
import { createHash } from "node:crypto";

function isTrue(v: string | undefined): boolean {
  return v === "true" || v === "1";
}

function normalizeE164(raw: string): string | null {
  const digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+") && /^\+[1-9]\d{6,14}$/.test(digits)) return digits;
  const only = raw.replace(/\D/g, "");
  if (only.length >= 10 && only.length <= 15) return `+${only}`;
  return null;
}

export type V1ShadowHookInput = {
  rawPhone: string;
  text: string;
  externalMessageId?: string;
  hasAttachment?: boolean;
  v1OutcomeCode?: string;
};

export function maybeEnqueueWaraV2ShadowCopy(input: V1ShadowHookInput): void {
  try {
    if (isTrue(process.env.WARA_V2_SHADOW_KILL)) return;
    if (!isTrue(process.env.WARA_V2_SHADOW)) return;
    if (!isTrue(process.env.WARA_V2_SHADOW_CANARY)) return;
    if (isTrue(process.env.DELIVERY_ENABLED)) return;
    if (!isTrue(process.env.EVALUATION_ONLY)) return;
    if (input.hasAttachment) return;

    const text = (input.text ?? "").trim();
    if (!text) return;
    const phone = normalizeE164(input.rawPhone);
    if (!phone) return;

    const messageId =
      input.externalMessageId ||
      createHash("sha256")
        .update(`${phone}|${text}`)
        .digest("hex")
        .slice(0, 32);

    const tenant =
      process.env.WARA_V2_SHADOW_TENANT?.trim() || "tenant_internal_ops";
    const port = process.env.WARA_V2_SHADOW_PORT || "8787";
    const host = process.env.WARA_V2_BIND_HOST || "127.0.0.1";
    if (host !== "127.0.0.1" && host !== "localhost") return;

    const url = `http://${host}:${port}/v2/shadow-canary`;
    const body = JSON.stringify({
      phone_e164: phone,
      tenant_id: tenant,
      text,
      message_id: messageId,
      has_attachment: false,
      v1_outcome_sanitized: input.v1OutcomeCode
        ? { outcome_code: input.v1OutcomeCode }
        : undefined,
    });

    // No await — aislamiento total de V1
    setImmediate(() => {
      void fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-correlation-id": messageId,
        },
        body,
        signal: AbortSignal.timeout(2000),
      }).catch(() => {
        /* V2 caído / lento: ignorar */
      });
    });
  } catch {
    /* V1 isolation */
  }
}
