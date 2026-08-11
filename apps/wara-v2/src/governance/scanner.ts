/**
 * Escáner de privacidad — no registra valores sensibles.
 */
import { createHash } from "node:crypto";

export type FindingSeverity = "critical" | "high" | "medium" | "low";

export type PrivacyFinding = {
  code: string;
  location: string;
  severity: FindingSeverity;
  action: "redact" | "block" | "none";
  value_hash: string;
};

const PATTERNS: Array<{
  code: string;
  severity: FindingSeverity;
  re: RegExp;
}> = [
  { code: "email", severity: "critical", re: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i },
  { code: "phone", severity: "critical", re: /(?:\+?54)?[\s-]?(?:9)?[\s-]?\d{2,4}[\s-]?\d{6,8}\b/ },
  { code: "dni", severity: "critical", re: /\b\d{7,8}\b/ },
  { code: "plate_ar", severity: "critical", re: /\b[A-Z]{2}\d{3}[A-Z]{2}\b|\b[A-Z]{3}\d{3}\b/i },
  { code: "vin", severity: "critical", re: /\b[A-HJ-NPR-Z0-9]{17}\b/i },
  { code: "url", severity: "high", re: /https?:\/\/[^\s]+/i },
  { code: "ip", severity: "high", re: /\b(?:\d{1,3}\.){3}\d{1,3}\b/ },
  { code: "coord", severity: "high", re: /\b-?\d{1,3}\.\d{4,},\s*-?\d{1,3}\.\d{4,}\b/ },
  { code: "api_key", severity: "critical", re: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { code: "bearer", severity: "critical", re: /Bearer\s+[A-Za-z0-9._\-]+/i },
  { code: "password", severity: "critical", re: /password\s*[:=]\s*\S+/i },
  { code: "internal_id", severity: "medium", re: /\b(?:op_|conv_|cust_|turn_)[a-f0-9-]{8,}\b/i },
];

function hashValue(v: string): string {
  return createHash("sha256").update(v, "utf8").digest("hex").slice(0, 16);
}

export function scanText(text: string, location: string): PrivacyFinding[] {
  const out: PrivacyFinding[] = [];
  for (const p of PATTERNS) {
    const m = text.match(p.re);
    if (m) {
      out.push({
        code: p.code,
        location,
        severity: p.severity,
        action: p.severity === "critical" ? "block" : "redact",
        value_hash: hashValue(m[0]!),
      });
    }
  }
  // nombre probable muy simple (2+ palabras capitalizadas) — medium
  if (/\b[A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,}\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,}\b/.test(text)) {
    const m = text.match(
      /\b[A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,}\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,}\b/,
    );
    out.push({
      code: "probable_name",
      location,
      severity: "medium",
      action: "redact",
      value_hash: hashValue(m?.[0] ?? "name"),
    });
  }
  return out;
}

export function scanRecord(
  record: Record<string, unknown>,
  basePath = "root",
): PrivacyFinding[] {
  const findings: PrivacyFinding[] = [];
  for (const [k, v] of Object.entries(record)) {
    const loc = `${basePath}.${k}`;
    if (typeof v === "string") findings.push(...scanText(v, loc));
    else if (v && typeof v === "object" && !Array.isArray(v)) {
      findings.push(...scanRecord(v as Record<string, unknown>, loc));
    } else if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (typeof item === "string") findings.push(...scanText(item, `${loc}[${i}]`));
      });
    }
  }
  return findings;
}

export function hasCritical(findings: PrivacyFinding[]): boolean {
  return findings.some((f) => f.severity === "critical");
}
