/**
 * Aislamiento canary hotfix V1 por número exacto.
 * Un deploy (preview o prod) con CANARY_ENABLED=true solo ejecuta código candidato
 * para teléfonos en allowlist; el resto se proxya a producción estable (031dc5a).
 */
import { normalizeWhatsAppPhone } from "@/lib/whatsappPhone";

const E164_RE = /^\+[1-9]\d{6,14}$/;

function isTrue(v: string | undefined): boolean {
  return v === "true" || v === "1" || v === "yes" || v === "si";
}

function normalizeE164(raw: string): string | null {
  const digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+") && E164_RE.test(digits)) return digits;
  const only = raw.replace(/\D/g, "");
  if (only.length >= 10 && only.length <= 15) {
    return only.startsWith("54") ? `+${only}` : `+${only}`;
  }
  return null;
}

export function parseV1HotfixCanaryAllowlist(raw: string | undefined): string[] {
  const text = (raw ?? "").trim();
  if (!text) return [];
  if (text.includes("*")) throw new Error("v1_hotfix_canary_wildcard_forbidden");
  const out: string[] = [];
  for (const part of text.split(/[,;\s]+/)) {
    const p = part.trim();
    if (!p) continue;
    const e164 = normalizeE164(p);
    if (!e164 || !E164_RE.test(e164)) {
      throw new Error(`v1_hotfix_canary_invalid_e164:${p.slice(0, 8)}`);
    }
    if (!out.includes(e164)) out.push(e164);
  }
  return out;
}

export function isV1HotfixCanaryEnabled(): boolean {
  return isTrue(process.env.WARA_V1_HOTFIX_CANARY_ENABLED?.trim());
}

export function v1HotfixCanaryAllowlist(): string[] {
  try {
    return parseV1HotfixCanaryAllowlist(process.env.WARA_V1_HOTFIX_CANARY_ALLOWLIST);
  } catch {
    return [];
  }
}

export function isV1HotfixCanaryAllowlistedPhone(rawPhone: string): boolean {
  if (!isV1HotfixCanaryEnabled()) return true;
  const list = v1HotfixCanaryAllowlist();
  if (list.length === 0) return false;
  const e164 = normalizeE164(rawPhone);
  if (e164 && list.includes(e164)) return true;
  const norm = normalizeWhatsAppPhone(rawPhone);
  for (const allowed of list) {
    const aNorm = normalizeWhatsAppPhone(allowed);
    if (norm && aNorm && norm === aNorm) return true;
    if (norm.startsWith("549") && aNorm === "54" + norm.slice(3)) return true;
    if (aNorm.startsWith("549") && norm === "54" + aNorm.slice(3)) return true;
  }
  return false;
}

export function v1HotfixCanaryFallbackBaseUrl(): string {
  return (
    process.env.WARA_V1_HOTFIX_CANARY_FALLBACK_URL?.trim() ||
    process.env.WARA_V1_PRODUCTION_URL?.trim() ||
    "https://wara.nivel41.com"
  ).replace(/\/+$/, "");
}

export type V1HotfixCanaryDecision =
  | { action: "process"; reason: "canary_off" | "allowlisted" }
  | { action: "proxy"; reason: "not_allowlisted"; fallbackUrl: string }
  | { action: "reject"; reason: "canary_misconfigured" };

export function resolveV1HotfixCanary(rawPhone: string): V1HotfixCanaryDecision {
  if (!isV1HotfixCanaryEnabled()) {
    return { action: "process", reason: "canary_off" };
  }
  let list: string[];
  try {
    list = parseV1HotfixCanaryAllowlist(process.env.WARA_V1_HOTFIX_CANARY_ALLOWLIST);
  } catch {
    return { action: "reject", reason: "canary_misconfigured" };
  }
  if (list.length === 0) {
    return { action: "reject", reason: "canary_misconfigured" };
  }
  if (isV1HotfixCanaryAllowlistedPhone(rawPhone)) {
    return { action: "process", reason: "allowlisted" };
  }
  return { action: "proxy", reason: "not_allowlisted", fallbackUrl: v1HotfixCanaryFallbackBaseUrl() };
}

export function v1HotfixCanaryStatus(): {
  enabled: boolean;
  allowlist: string[];
  fallbackUrl: string;
  commitSha: string | null;
} {
  return {
    enabled: isV1HotfixCanaryEnabled(),
    allowlist: v1HotfixCanaryAllowlist(),
    fallbackUrl: v1HotfixCanaryFallbackBaseUrl(),
    commitSha: process.env.VERCEL_GIT_COMMIT_SHA?.trim() || null,
  };
}
