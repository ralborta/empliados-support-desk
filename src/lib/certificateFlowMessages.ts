/**
 * Mensajes del trámite de certificado que deben "anclar" el estado del hilo
 * (ver `certificateFlowState` en `@/lib/wara`). Viven en un módulo aparte, sin
 * dependencias de Prisma/Next, para poder testearlos sin levantar la DB.
 */

export function askCertificateUnitMessage(): string {
  return (
    "Para el certificado de cobertura necesito la unidad: decime la patente (ej. AD 427 MC), " +
    "el nombre o la marca (ej. Saveiro, Nissan) o un prefijo (ej. HEJ)."
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
  return (
    `${trimmed} Para el certificado de cobertura necesito la unidad: decime la patente completa, ` +
    `el nombre/marca o un prefijo válido.`
  );
}
