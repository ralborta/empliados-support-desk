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
 * Fase 1 (legacy): BBC envía vía messageMapping cuando skipResponse_s=false.
 * @deprecated Preferir shouldTurnSendWhatsAppToCustomer (Fase 2).
 */
export function bbcShouldSendExecutorMessage(): boolean {
  if (shouldTurnSendWhatsAppToCustomer()) return false;
  return isWaraInboundAuditOnly();
}

/**
 * Fase 2 — el turno (/api/whatsapp/turn) envía WhatsApp por API (sendWhatsAppMessage).
 * BBC queda mudo (skipResponse_s=true) salvo fallback si falla el envío.
 *
 * Rollback: WARA_TURN_BACKEND_SEND=false en Vercel → vuelve messageMapping de BBC.
 */
export function shouldTurnSendWhatsAppToCustomer(): boolean {
  const raw = process.env.WARA_TURN_BACKEND_SEND?.trim().toLowerCase();
  if (raw === "false" || raw === "0" || raw === "no" || raw === "legacy") return false;
  if (raw === "true" || raw === "1" || raw === "yes") return true;
  return isWaraInboundAuditOnly();
}
