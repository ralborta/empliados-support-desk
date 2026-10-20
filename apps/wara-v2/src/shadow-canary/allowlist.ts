/**
 * Allowlist cerrada 10A — solo E.164 exactos.
 * Rechaza *, patrones, tenant completo, vacía.
 */
const E164_RE = /^\+[1-9]\d{6,14}$/;

export function parseExactPhoneAllowlist(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  if (trimmed === "*" || trimmed.includes("*")) {
    throw new Error("allowlist_wildcard_forbidden");
  }
  // patrones amplios
  if (/[.?\[\]()]/.test(trimmed) || trimmed.toLowerCase().includes("tenant")) {
    throw new Error("allowlist_pattern_forbidden");
  }
  const parts = trimmed.split(/[,\s]+/).map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of parts) {
    if (p === "*") throw new Error("allowlist_wildcard_forbidden");
    if (!E164_RE.test(p)) throw new Error(`allowlist_invalid_e164:${p.slice(0, 6)}`);
    if (!seen.has(p)) {
      seen.add(p);
      out.push(p);
    }
  }
  return out;
}

export function isPhoneAllowlisted(
  phoneE164: string,
  allowlist: readonly string[],
): boolean {
  if (allowlist.length === 0) return false;
  return allowlist.includes(phoneE164);
}

export function assertTenantAllowed(
  tenantId: string,
  authorizedTenant: string,
): void {
  if (!tenantId || tenantId !== authorizedTenant) {
    throw new Error("tenant_not_allowlisted");
  }
}

/** Enmascara para logs: +54911****5678 */
export function maskPhone(phoneE164: string): string {
  if (phoneE164.length < 8) return "+***";
  return `${phoneE164.slice(0, 6)}****${phoneE164.slice(-4)}`;
}
