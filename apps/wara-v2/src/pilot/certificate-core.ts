/**
 * Reglas determinísticas certificado de cobertura V2 (portadas de V1).
 */
import { looksLikeCertificateService } from "./service-catalog.js";

export function looksLikeCertificateIntent(text: string | undefined | null): boolean {
  return looksLikeCertificateService(text);
}

export function looksLikeCancelCertificate(text: string | undefined | null): boolean {
  const t = String(text ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
  if (!t) return false;
  if (/^(cancelar|cancela|salir|abortar|detener)$/.test(t)) return true;
  return (
    /\bno\s+(quiero|necesito)\b[^.!?]*\b(certificado|cobertura|poliza|comprobante)\b/.test(t) ||
    /\b(cancelar|cancela|anular|olvidal[oa])\b[^.!?]*\b(certificado|cobertura|tramite)?\b/.test(t)
  );
}

export const CERTIFICATE_TYPES = [{ id: "cobertura", label: "Certificado de cobertura" }] as const;

export type CertificateTypeId = (typeof CERTIFICATE_TYPES)[number]["id"];

export function resolveCertificateType(text: string): CertificateTypeId {
  const t = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (/\bcobertura\b/.test(t) || /\bcertificado\b/.test(t) || /\bpoliza\b/.test(t) || /\bcomprobante\b/.test(t)) {
    return "cobertura";
  }
  return "cobertura";
}
