/**
 * Mensajes del trámite de certificado que deben "anclar" el estado del hilo
 * (ver `certificateFlowState` en `@/lib/wara`). Viven en un módulo aparte, sin
 * dependencias de Prisma/Next, para poder testearlos sin levantar la DB.
 */

export function askCertificateUnitMessage(): string {
  return [
    "📋 *Certificado*",
    "",
    "Para el certificado de cobertura necesito la unidad:",
    "🔢 Pasame la *patente* (ej. AD 427 MC), el *código* (ej. M900-088) o un *prefijo* (ej. HEJ).",
  ].join("\n");
}

function normalizeCertFlowLine(line: string): string {
  return line
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/** Línea del bot que ancla el trámite de certificado en espera de unidad (incluye redacción del agente). */
export function botLineAnchorsCertificateUnitAsk(line: string): boolean {
  const l = normalizeCertFlowLine(line);
  if (/para el certificado de cobertura necesito la unidad/.test(l)) return true;
  if (/para generar el certificado/.test(l) && /(patente|unidad|matricula)/.test(l)) return true;
  if (/confirmar certificado/.test(l)) return true;
  if (/necesito.{0,50}certificado.{0,100}(patente|unidad|matricula)/.test(l)) return true;
  if (/cu[aá]l unidad\?\s*pasame la matr[ií]cula/.test(l)) return true;
  if (/^📋/.test(line.trim()) && /certificado/.test(l)) return true;
  return false;
}

/** Aclaración del bot pidiendo matrícula/código mientras sigue activo un certificado. */
export function botLineIsCertificateUnitClarification(line: string): boolean {
  const l = normalizeCertFlowLine(line);
  if (/^📋/.test(line.trim()) && /certificado/.test(l)) return true;
  return (
    /matr[ií]cula o el c[oó]digo de la unidad/.test(l) ||
    /parte de la patente de la unidad/.test(l) ||
    /confirmes la patente/.test(l)
  );
}

/**
 * Ancla cualquier mensaje de aclaración de unidad al trámite de certificado. Sin esta
 * frase exacta, `certificateFlowState` no reconoce el hilo como "awaiting_unit" y el
 * próximo mensaje del cliente (p. ej. "y la LWK") se enruta al flujo general de
 * unidades en vez de retomar el certificado — el bot termina reportando estado de
 * GPS en vez de generar el certificado pedido (bug real, producción 2026-07-22).
 */
export function anchorToCertificateUnitFlow(message: string): string {
  const trimmed = message.trim();
  if (/para el certificado de cobertura necesito la unidad/i.test(trimmed)) return trimmed;
  if (/^📋\s*\*certificado\*/i.test(trimmed)) return trimmed;
  return `${trimmed}\n\n${askCertificateUnitMessage()}`;
}
