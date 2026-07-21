/**
 * Fase 0: el webhook /api/whatsapp/inbound persiste tickets/mensajes para el panel
 * pero no envía WhatsApp al cliente (BBC + ejecutores HTTP son la única voz).
 *
 * Rollback: WARA_INBOUND_AUDIT_ONLY=false en Vercel.
 * Por defecto activo (audit-only) si la variable no está definida.
 */
export function isWaraInboundAuditOnly(): boolean {
  const raw = process.env.WARA_INBOUND_AUDIT_ONLY?.trim().toLowerCase();
  if (!raw) return true;
  return !["false", "0", "no", "off", "legacy"].includes(raw);
}

/** ¿Puede el webhook inbound enviar WhatsApp directo al cliente? */
export function shouldInboundSendWhatsAppToCustomer(): boolean {
  return !isWaraInboundAuditOnly();
}

/**
 * En audit-only el ejecutor HTTP debe devolver skipResponse_s=false para que BBC envíe
 * el message al cliente (el inbound ya no manda WA directo).
 */
export function bbcShouldSendExecutorMessage(): boolean {
  return isWaraInboundAuditOnly();
}
