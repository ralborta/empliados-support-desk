/**
 * Reglas determinísticas certificado de cobertura V2 (portadas de V1).
 */
function norm(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function looksLikeCertificateIntent(text: string | undefined | null): boolean {
  const t = norm(String(text ?? ""));
  if (!t) return false;
  if (/\b(od[oó]metro|hor[oó]metro|mantenimiento|gps|reporte)\b/.test(t)) return false;
  return /\b(certificado|cobertura|constancia de cobertura)\b/.test(t);
}

export function looksLikeCancelCertificate(text: string | undefined | null): boolean {
  const t = norm(String(text ?? ""));
  if (!t) return false;
  return (
    /\bno\s+(quiero|necesito)\b[^.!?]*\b(certificado|cobertura)\b/.test(t) ||
    /\b(cancelar|cancela|anular|olvidal[oa])\b/.test(t)
  );
}

export const CERTIFICATE_TYPES = [{ id: "cobertura", label: "Certificado de cobertura" }] as const;

export type CertificateTypeId = (typeof CERTIFICATE_TYPES)[number]["id"];

export function resolveCertificateType(text: string): CertificateTypeId {
  const t = norm(text);
  if (/\bcobertura\b/.test(t) || /\bcertificado\b/.test(t)) return "cobertura";
  return "cobertura";
}
