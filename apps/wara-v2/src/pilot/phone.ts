/**
 * Normalización de teléfono para piloto WhatsApp V2.
 * Compara dígitos (sufijo ≥ 8) para no perder el allowlist por formato BBC.
 */

export function digitsOnly(raw: string): string {
  return String(raw ?? "").replace(/\D/g, "");
}

export function toE164Guess(raw: string): string {
  const d = digitsOnly(raw);
  if (!d) return "";
  if (d.startsWith("54")) return `+${d}`;
  if (d.startsWith("9") && d.length >= 10) return `+54${d}`;
  if (d.length === 10) return `+549${d}`;
  return `+${d}`;
}

export function phonesMatch(a: string, b: string): boolean {
  const da = digitsOnly(a);
  const db = digitsOnly(b);
  if (!da || !db) return false;
  if (da === db) return true;
  const short = da.length < db.length ? da : db;
  const long = da.length < db.length ? db : da;
  return short.length >= 8 && long.endsWith(short);
}

export function isAllowlistedPhone(
  rawPhone: string,
  allowlist: readonly string[],
): boolean {
  return allowlist.some((p) => phonesMatch(rawPhone, p));
}
