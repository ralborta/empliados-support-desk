/**
 * Hook V1 → shadow canary 10A (fire-and-forget).
 * Preferencia: in-process (Vercel/Next). Fallback HTTP loopback local.
 * Fail-closed sin flags. Cero impacto en respuesta V1.
 */
import { createHash } from "node:crypto";
import { waitUntil } from "@vercel/functions";
import { runShadowCanaryInProcess } from "@/lib/shadowCanaryInProcess";

function isTrue(v: string | undefined): boolean {
  return v === "true" || v === "1";
}

function normalizeE164(raw: string): string | null {
  const digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+") && /^\+[1-9]\d{6,14}$/.test(digits)) return digits;
  const only = raw.replace(/\D/g, "");
  if (only.length >= 10 && only.length <= 15) {
    // AR mobile often stored as 54911...
    return only.startsWith("54") ? `+${only}` : `+${only}`;
  }
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

    const job = async () => {
      try {
        await runShadowCanaryInProcess({
          phone_e164: phone,
          text,
          message_id: messageId,
          tenant_id: tenant,
          has_attachment: false,
          v1_outcome_code: input.v1OutcomeCode,
        });
      } catch {
        /* V1 isolation */
      }

      // Fallback opcional a API loopback (dev local)
      const host = process.env.WARA_V2_BIND_HOST || "127.0.0.1";
      if (host !== "127.0.0.1" && host !== "localhost") return;
      const port = process.env.WARA_V2_SHADOW_PORT || "8787";
      try {
        await fetch(`http://${host}:${port}/v2/shadow-canary`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-correlation-id": messageId,
          },
          body: JSON.stringify({
            phone_e164: phone,
            tenant_id: tenant,
            text,
            message_id: `${messageId}_http`,
            has_attachment: false,
          }),
          signal: AbortSignal.timeout(1500),
        });
      } catch {
        /* API local ausente: ok */
      }
    };

    try {
      waitUntil(job());
    } catch {
      setImmediate(() => {
        void job();
      });
    }
  } catch {
    /* V1 isolation */
  }
}
