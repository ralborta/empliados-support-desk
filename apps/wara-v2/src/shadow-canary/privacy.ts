/**
 * Privacidad pre-modelo 10A — scrub + deid + escaneo.
 * Bloquea hallazgos críticos residuales. Sin adjuntos.
 */
import {
  createEphemeralDeidKey,
  deidentifyMessage,
  type DeidMessage,
  type RawMessage,
} from "../governance/deid.js";
import { scanText, hasCritical } from "../governance/scanner.js";

export type ShadowPrivacyInput = {
  tenant_id: string;
  conversation_id: string;
  text: string;
  has_attachment?: boolean;
};

export type ShadowPrivacyOk = {
  ok: true;
  deid: DeidMessage;
  pre_critical: number;
  post_critical: 0;
};

export type ShadowPrivacyBlocked = {
  ok: false;
  reason: string;
};

export function prepareShadowSegment(
  input: ShadowPrivacyInput,
): ShadowPrivacyOk | ShadowPrivacyBlocked {
  if (input.has_attachment) {
    return { ok: false, reason: "attachments_excluded" };
  }
  let text = input.text ?? "";
  if (!text.trim()) return { ok: false, reason: "empty_text" };

  // scrub previo
  text = text.replace(
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
    "[EMAIL]",
  );
  text = text.replace(
    /(?:\+|00)(?:54)?[\s-]?(?:9)?[\s-]?\d{2,4}[\s-]?\d{6,8}\b|\b0\d{2,4}[\s-]?\d{6,8}\b/g,
    "[TEL]",
  );
  text = text.replace(/https?:\/\/[^\s]+/gi, "[URL]");
  text = text.replace(
    /\b[A-Z]{2}\d{3}[A-Z]{2}\b|\b[A-Z]{3}\d{3}\b/gi,
    "[PLATE]",
  );
  if (/(password|api[_-]?key|token|bearer)\s*[:=]/i.test(text)) {
    return { ok: false, reason: "credentials_blocked" };
  }

  const pre = scanText(text, "shadow.pre");
  const pre_critical = pre.filter((f) => f.severity === "critical").length;

  const raw: RawMessage = {
    tenant_id: input.tenant_id,
    conversation_id: input.conversation_id,
    turn_index: 0,
    message_role: "user",
    text,
  };
  const key = createEphemeralDeidKey();
  const deid = deidentifyMessage(key, raw);
  const post = scanText(deid.text, "shadow.post");
  if (hasCritical(post)) {
    return { ok: false, reason: "critical_residual" };
  }
  return {
    ok: true,
    deid,
    pre_critical,
    post_critical: 0,
  };
}
